import type {
  IDataObject,
  IExecuteFunctions,
  IHttpRequestOptions,
  ILoadOptionsFunctions,
  JsonObject,
} from "n8n-workflow";
import { NodeApiError, NodeOperationError } from "n8n-workflow";

export const API_BASE = "https://api.pdfparse.net/v1";
export const MAX_PDF_BYTES = 8 * 1024 * 1024;
type Context = IExecuteFunctions | ILoadOptionsFunctions;

// The credential is only used for fixed PdfParse API destinations. Redirects
// are disabled, including on the server-provided TUS upload location.
export async function apiRequest(
  context: Context,
  path: string,
  options: Partial<IHttpRequestOptions> = {},
): Promise<IDataObject | IDataObject[]> {
  try {
    return await context.helpers.httpRequestWithAuthentication.call(
      context,
      "pdfParseApi",
      {
        ...options,
        url: `${API_BASE}${path}`,
        method: options.method ?? "GET",
        headers: { "User-Agent": "PdfParse-n8n/0.1.0", ...options.headers },
        disableFollowRedirect: true,
        timeout: 30000,
        json: options.json ?? true,
      },
    );
  } catch (error) {
    throw new NodeApiError(context.getNode(), error as JsonObject);
  }
}

export function uploadPath(location: unknown): string {
  if (typeof location !== "string")
    throw new Error("PdfParse did not return an upload location");
  const url = new URL(location, `${API_BASE}/uploads`);
  if (
    url.origin !== "https://api.pdfparse.net" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/v1\/uploads\/[A-Za-z0-9_-]+$/.test(url.pathname)
  ) {
    throw new Error("PdfParse returned an unexpected upload location");
  }
  return url.pathname.slice("/v1".length);
}

export async function uploadAndExtract(
  context: IExecuteFunctions,
  itemIndex: number,
  tableId: string,
): Promise<IDataObject> {
  const binaryProperty = context.getNodeParameter(
    "binaryPropertyName",
    itemIndex,
  ) as string;
  const binary = context.helpers.assertBinaryData(itemIndex, binaryProperty);
  const bytes = await context.helpers.getBinaryDataBuffer(
    itemIndex,
    binaryProperty,
  );
  const filename =
    (context.getNodeParameter("fileName", itemIndex, "") as string).trim() ||
    binary.fileName ||
    "document.pdf";
  if (
    !/\.pdf$/i.test(filename) ||
    filename.length > 255 ||
    /[\r\n/\\]/.test(filename)
  ) {
    throw new NodeOperationError(
      context.getNode(),
      "Use a PDF filename without path separators and at most 255 characters",
      { itemIndex },
    );
  }
  if (
    !bytes.length ||
    bytes.length > MAX_PDF_BYTES ||
    bytes.subarray(0, 5).toString("ascii") !== "%PDF-"
  ) {
    throw new NodeOperationError(
      context.getNode(),
      "Provide a PDF file of at most 8 MiB in the input binary field",
      { itemIndex },
    );
  }
  const table = (await apiRequest(
    context,
    `/tables/${encodeURIComponent(tableId)}`,
  )) as IDataObject;
  const metadata = {
    filename,
    name: filename,
    type: "application/pdf",
    file_size: String(bytes.length),
    routingMode: "deferred",
  };
  const created = (await apiRequest(context, "/uploads", {
    method: "POST",
    returnFullResponse: true,
    json: false,
    headers: {
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(bytes.length),
      "Upload-Metadata": Object.entries(metadata)
        .map(
          ([key, value]) => `${key} ${Buffer.from(value).toString("base64")}`,
        )
        .join(","),
    },
  })) as IDataObject;
  if (created.statusCode !== 201)
    throw new NodeOperationError(
      context.getNode(),
      "PdfParse could not create the PDF upload",
      { itemIndex },
    );
  let path: string;
  try {
    path = uploadPath((created.headers as IDataObject)?.location);
  } catch (error) {
    throw new NodeOperationError(context.getNode(), error as Error, {
      itemIndex,
    });
  }
  const completed = (await apiRequest(context, path, {
    method: "PATCH",
    body: bytes,
    json: false,
    returnFullResponse: true,
    headers: {
      "Tus-Resumable": "1.0.0",
      "Upload-Offset": "0",
      "Content-Type": "application/offset+octet-stream",
    },
  })) as IDataObject;
  if (
    ![200, 204].includes(Number(completed.statusCode)) ||
    Number((completed.headers as IDataObject)?.["upload-offset"]) !==
      bytes.length
  ) {
    throw new NodeOperationError(
      context.getNode(),
      "The PDF upload did not finish",
      {
        itemIndex,
        description:
          "Check the document in PdfParse before retrying. Repeating this operation creates another upload.",
      },
    );
  }
  const documentId = path.slice("/uploads/".length);
  const job = (await apiRequest(context, "/jobs", {
    method: "POST",
    headers: { "Idempotency-Key": `n8n:upload:${documentId}` },
    body: { tableSlug: table.slug, documentKeys: [documentId] },
  })) as IDataObject;
  return {
    job_id: job.id,
    document_id: documentId,
    status: job.status,
    table_id: tableId,
    filename,
  };
}
