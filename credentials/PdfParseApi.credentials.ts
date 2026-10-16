import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
  Icon,
} from "n8n-workflow";

export class PdfParseApi implements ICredentialType {
  name = "pdfParseApi";
  displayName = "PdfParse API";
  icon: Icon = {
    light: "file:../nodes/PdfParse/pdfparse.svg",
    dark: "file:../nodes/PdfParse/pdfparse.svg",
  };
  documentationUrl =
    "https://github.com/PabloG6/n8n-nodes-pdfparse#credentials";
  httpRequestNode = {
    name: "PdfParse",
    docsUrl: "https://pdfparse.net/docs/api-reference",
    apiBaseUrl: "https://api.pdfparse.net/v1",
  };
  properties: INodeProperties[] = [
    {
      displayName: "Project API Key",
      name: "apiKey",
      type: "string",
      typeOptions: { password: true },
      required: true,
      default: "",
      description:
        "API key created in the PdfParse project you want to connect",
    },
  ];
  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: { Authorization: "=Bearer {{$credentials.apiKey}}" },
    },
  };
  test: ICredentialTestRequest = {
    request: {
      baseURL: "https://api.pdfparse.net/v1",
      url: "/tables",
      method: "GET",
      headers: { "User-Agent": "PdfParse-n8n/0.1.0" },
      skipSslCertificateValidation: false,
    },
  };
}
