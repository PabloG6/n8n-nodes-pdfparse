const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PdfParse } = require("../dist/nodes/PdfParse/PdfParse.node");
const { PdfParseApi } = require("../dist/credentials/PdfParseApi.credentials");
const {
  API_BASE,
  uploadPath,
} = require("../dist/nodes/PdfParse/GenericFunctions");
const { NodeHelpers } = require("n8n-workflow");

test("n8n shows a table selector exactly for the operations that need one", () => {
  const description = new PdfParse().description;
  for (const [resource, operation, expected] of [
    ["document", "uploadAndExtract", 1],
    ["row", "getMany", 1],
    ["table", "get", 1],
    ["table", "getMany", 0],
    ["job", "get", 0],
  ]) {
    const visible = description.properties.filter(
      (property) =>
        property.name === "tableId" &&
        NodeHelpers.displayParameter(
          { resource, operation },
          property,
          { typeVersion: 1 },
          description,
        ),
    );
    assert.equal(visible.length, expected, `${resource}.${operation}`);
  }
});

function context(params, responses = [], inputs = [{ json: {} }]) {
  const requests = [];
  const ctx = {
    getInputData: () => inputs,
    getNode: () => ({
      name: "PdfParse",
      type: "n8n-nodes-pdfparse.pdfParse",
      typeVersion: 1,
      position: [0, 0],
      parameters: params,
    }),
    getNodeParameter: (name, i, fallback) => params[name] ?? fallback,
    continueOnFail: () => false,
    helpers: {
      httpRequestWithAuthentication: async function (credential, options) {
        assert.equal(credential, "pdfParseApi");
        requests.push(options);
        assert.equal(new URL(options.url).origin, "https://api.pdfparse.net");
        assert.equal(options.disableFollowRedirect, true);
        const response = responses.shift();
        if (response instanceof Error) throw response;
        assert.notEqual(response, undefined, "Unexpected API request");
        return response;
      },
      assertBinaryData: () => ({
        fileName: "invoice.pdf",
        mimeType: "application/pdf",
      }),
      getBinaryDataBuffer: async () => Buffer.from("%PDF-1.7\nfixture"),
    },
  };
  return { ctx, requests };
}

test("credentials use a masked project key and a real authenticated connection check", () => {
  const c = new PdfParseApi();
  assert.equal(c.properties[0].typeOptions.password, true);
  assert.equal(c.test.request.url, "/tables");
  assert.match(
    c.authenticate.properties.headers.Authorization,
    /credentials.apiKey/,
  );
});
test("tables are emitted as individual items with input lineage", async () => {
  const { ctx } = context(
    {
      resource: "table",
      operation: "getMany",
      returnAll: false,
      limit: 1,
      simplify: true,
    },
    [
      [
        {
          id: "a",
          name: "Invoices",
          slug: "invoices",
          sensitiveInternal: "omit",
        },
        { id: "b" },
      ],
    ],
  );
  const [out] = await PdfParse.prototype.execute.call(ctx);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    json: { id: "a", name: "Invoices", slug: "invoices" },
    pairedItem: { item: 0 },
  });
});
test("rows follow pagination and preserve document filtering on every page", async () => {
  const { ctx, requests } = context(
    {
      resource: "row",
      operation: "getMany",
      tableId: "t",
      returnAll: true,
      rowOptions: { documentId: "d" },
    },
    [
      { results: [{ id: 1 }], pageCount: 2 },
      { results: [{ id: 2 }], pageCount: 2 },
    ],
  );
  const [out] = await PdfParse.prototype.execute.call(ctx);
  assert.deepEqual(
    out.map((x) => x.json.id),
    [1, 2],
  );
  assert.deepEqual(
    requests.map((x) => x.body.page),
    [1, 2],
  );
  for (const r of requests)
    assert.deepEqual(r.body.filters, [
      { column: "document_record_id", op: "eq", value: "d" },
    ]);
});
test("limited rows keep page size stable to avoid duplicates and slice the final response", async () => {
  const { ctx, requests } = context(
    {
      resource: "row",
      operation: "getMany",
      tableId: "t",
      returnAll: false,
      limit: 201,
      rowOptions: {},
    },
    [
      {
        results: Array.from({ length: 200 }, (_, id) => ({ id })),
        pageCount: 3,
      },
      {
        results: Array.from({ length: 200 }, (_, id) => ({ id: id + 200 })),
        pageCount: 3,
      },
    ],
  );
  const [out] = await PdfParse.prototype.execute.call(ctx);
  assert.equal(out.length, 201);
  assert.equal(out[200].json.id, 200);
  assert.deepEqual(
    requests.map((x) => x.body.pageSize),
    [200, 200],
  );
});
test("job IDs cannot become arbitrary API paths", async () => {
  const { ctx, requests } = context({
    resource: "job",
    operation: "get",
    jobId: "../tables",
  });
  await assert.rejects(
    PdfParse.prototype.execute.call(ctx),
    /positive integer/,
  );
  assert.equal(requests.length, 0);
});
test("job raw output retains batches when Simplify is off", async () => {
  const { ctx } = context(
    { resource: "job", operation: "get", jobId: 7, simplify: false },
    [{ id: 7, status: "completed", batches: [{ id: 1 }] }],
  );
  const [out] = await PdfParse.prototype.execute.call(ctx);
  assert.equal(out[0].json.batches.length, 1);
});
test("PDF uploads complete TUS before creating an idempotent asynchronous job", async () => {
  const bytes = Buffer.from("%PDF-1.7\nfixture");
  const { ctx, requests } = context(
    {
      resource: "document",
      operation: "uploadAndExtract",
      tableId: "t",
      binaryPropertyName: "data",
      fileName: "",
    },
    [
      { id: "t", slug: "invoices-abc" },
      { statusCode: 201, headers: { location: "/v1/uploads/doc-1" } },
      { statusCode: 204, headers: { "upload-offset": String(bytes.length) } },
      { id: 7, status: "queued" },
    ],
  );
  const [out] = await PdfParse.prototype.execute.call(ctx);
  assert.deepEqual(
    requests.map((x) => [x.method, x.url]),
    [
      ["GET", `${API_BASE}/tables/t`],
      ["POST", `${API_BASE}/uploads`],
      ["PATCH", `${API_BASE}/uploads/doc-1`],
      ["POST", `${API_BASE}/jobs`],
    ],
  );
  assert.deepEqual(requests[2].body, bytes);
  assert.equal(requests[3].headers["Idempotency-Key"], "n8n:upload:doc-1");
  assert.deepEqual(requests[3].body, {
    tableSlug: "invoices-abc",
    documentKeys: ["doc-1"],
  });
  assert.deepEqual(out[0].json, {
    job_id: 7,
    document_id: "doc-1",
    status: "queued",
    table_id: "t",
    filename: "invoice.pdf",
  });
});
test("malicious upload locations never receive an authenticated request", async () => {
  for (const location of [
    "https://evil.example/v1/uploads/a",
    "https://api.pdfparse.net.evil.example/v1/uploads/a",
    "https://user@api.pdfparse.net/v1/uploads/a",
    "/v1/jobs/1",
    "/v1/uploads/a?redirect=evil",
    "/v1/uploads/a%2fb",
  ]) {
    assert.throws(() => uploadPath(location));
    const { ctx, requests } = context(
      {
        resource: "document",
        operation: "uploadAndExtract",
        tableId: "t",
        binaryPropertyName: "data",
      },
      [{ slug: "invoices" }, { statusCode: 201, headers: { location } }],
    );
    await assert.rejects(
      PdfParse.prototype.execute.call(ctx),
      /unexpected upload location/,
    );
    assert.equal(requests.length, 2);
  }
});
test("invalid and oversized PDFs are rejected before creating an upload", async () => {
  for (const bytes of [
    Buffer.from("<html>not a PDF"),
    Buffer.alloc(8 * 1024 * 1024 + 1),
  ]) {
    const { ctx, requests } = context({
      resource: "document",
      operation: "uploadAndExtract",
      tableId: "t",
      binaryPropertyName: "data",
    });
    ctx.helpers.getBinaryDataBuffer = async () => bytes;
    await assert.rejects(
      PdfParse.prototype.execute.call(ctx),
      /PDF file of at most/,
    );
    assert.equal(requests.length, 0);
  }
});
test("incomplete uploads cannot start extraction", async () => {
  const { ctx, requests } = context(
    {
      resource: "document",
      operation: "uploadAndExtract",
      tableId: "t",
      binaryPropertyName: "data",
    },
    [
      { slug: "invoices" },
      { statusCode: 201, headers: { location: "/v1/uploads/d" } },
      { statusCode: 204, headers: { "upload-offset": "0" } },
    ],
  );
  await assert.rejects(
    PdfParse.prototype.execute.call(ctx),
    /upload did not finish/,
  );
  assert.equal(requests.length, 3);
});
test("continue on fail returns one correctly paired error and does not append inputs", async () => {
  const input = [{ json: { original: true } }];
  const { ctx } = context(
    { resource: "job", operation: "get", jobId: 0 },
    [],
    input,
  );
  ctx.continueOnFail = () => true;
  const [out] = await PdfParse.prototype.execute.call(ctx);
  assert.equal(out.length, 1);
  assert.equal(out[0].pairedItem.item, 0);
  assert.match(out[0].json.error, /positive integer/);
  assert.equal(input.length, 1);
  assert.equal(input[0].json.original, true);
});
