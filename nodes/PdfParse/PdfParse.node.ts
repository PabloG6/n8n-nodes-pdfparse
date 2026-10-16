import type {
  IDataObject,
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodeExecutionData,
  INodePropertyOptions,
  INodeType,
  INodeTypeDescription,
  INodeProperties,
} from "n8n-workflow";
import { NodeConnectionTypes, NodeOperationError } from "n8n-workflow";
import { apiRequest, uploadAndExtract } from "./GenericFunctions";

const properties: INodeProperties[] = [
  {
    displayName: "Resource",
    name: "resource",
    type: "options",
    noDataExpression: true,
    options: [
      { name: "Document", value: "document" },
      { name: "Extraction Job", value: "job" },
      { name: "Row", value: "row" },
      { name: "Table", value: "table" },
    ],
    default: "document",
  },
  {
    displayName: "Operation",
    name: "operation",
    type: "options",
    noDataExpression: true,
    displayOptions: { show: { resource: ["document"] } },
    options: [
      {
        name: "Upload and Extract",
        value: "uploadAndExtract",
        description: "Upload a PDF and start extraction into an existing table",
        action: "Upload and extract document",
      },
    ],
    default: "uploadAndExtract",
  },
  {
    displayName: "Operation",
    name: "operation",
    type: "options",
    noDataExpression: true,
    displayOptions: { show: { resource: ["job"] } },
    options: [
      {
        name: "Get",
        value: "get",
        description: "Retrieve an extraction job and its current status",
        action: "Get extraction job",
      },
    ],
    default: "get",
  },
  {
    displayName: "Operation",
    name: "operation",
    type: "options",
    noDataExpression: true,
    displayOptions: { show: { resource: ["row"] } },
    options: [
      {
        name: "Get Many",
        value: "getMany",
        description: "Retrieve extracted rows from a table",
        action: "Get many rows",
      },
    ],
    default: "getMany",
  },
  {
    displayName: "Operation",
    name: "operation",
    type: "options",
    noDataExpression: true,
    displayOptions: { show: { resource: ["table"] } },
    options: [
      {
        name: "Get",
        value: "get",
        description: "Retrieve a table and its extraction schema",
        action: "Get table",
      },
      {
        name: "Get Many",
        value: "getMany",
        description: "Retrieve tables in the connected project",
        action: "Get many tables",
      },
    ],
    default: "getMany",
  },
  {
    displayName: "Table Name or ID",
    name: "tableId",
    type: "options",
    typeOptions: { loadOptionsMethod: "getTables" },
    required: true,
    default: "",
    displayOptions: {
      show: { resource: ["document", "row"] },
    },
    description:
      'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
  },
  {
    displayName: "Table Name or ID",
    name: "tableId",
    type: "options",
    typeOptions: { loadOptionsMethod: "getTables" },
    required: true,
    default: "",
    displayOptions: { show: { resource: ["table"], operation: ["get"] } },
    description:
      'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
  },
  {
    displayName: "Input Binary Field",
    name: "binaryPropertyName",
    type: "string",
    default: "data",
    required: true,
    displayOptions: { show: { resource: ["document"] } },
    description:
      "Name of the input binary field containing a PDF of at most 8 MiB",
  },
  {
    displayName: "File Name",
    name: "fileName",
    type: "string",
    default: "",
    placeholder: "e.g. invoice.pdf",
    displayOptions: { show: { resource: ["document"] } },
    description:
      "Optional PDF filename override. Uses the incoming filename when empty.",
  },
  {
    displayName: "Job ID",
    name: "jobId",
    type: "number",
    typeOptions: { minValue: 1 },
    default: 1,
    required: true,
    displayOptions: { show: { resource: ["job"] } },
    description: "ID returned by Upload and Extract",
  },
  {
    displayName: "Return All",
    name: "returnAll",
    type: "boolean",
    default: false,
    displayOptions: {
      show: { resource: ["row", "table"], operation: ["getMany"] },
    },
    description: "Whether to return all results or only up to a given limit",
  },
  {
    displayName: "Limit",
    name: "limit",
    type: "number",
    default: 50,
    typeOptions: { minValue: 1, maxValue: 10000 },
    displayOptions: {
      show: {
        resource: ["row", "table"],
        operation: ["getMany"],
        returnAll: [false],
      },
    },
    description: "Max number of results to return",
  },
  {
    displayName: "Options",
    name: "rowOptions",
    type: "collection",
    placeholder: "Add Option",
    default: {},
    displayOptions: { show: { resource: ["row"] } },
    options: [
      {
        displayName: "Source Document ID",
        name: "documentId",
        type: "string",
        default: "",
        description: "Only return rows saved for this document",
      },
    ],
  },
  {
    displayName: "Simplify",
    name: "simplify",
    type: "boolean",
    default: true,
    displayOptions: { show: { resource: ["job", "table"] } },
    description:
      "Whether to return a simplified version of the response instead of the raw data",
  },
];

export class PdfParse implements INodeType {
  description: INodeTypeDescription = {
    displayName: "PdfParse",
    name: "pdfParse",
    icon: { light: "file:pdfparse.svg", dark: "file:pdfparse.svg" },
    group: ["transform"],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: "Extract PDF data into structured tables with PdfParse",
    defaults: { name: "PdfParse" },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: "pdfParseApi", required: true }],
    usableAsTool: true,
    properties,
  };
  methods = {
    loadOptions: {
      async getTables(
        this: ILoadOptionsFunctions,
      ): Promise<INodePropertyOptions[]> {
        const tables = (await apiRequest(this, "/tables")) as IDataObject[];
        return tables
          .map((table) => ({
            name: String(table.name),
            value: String(table.id),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
      },
    },
  };
  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const output: INodeExecutionData[] = [];
    for (
      let itemIndex = 0;
      itemIndex < this.getInputData().length;
      itemIndex++
    ) {
      try {
        const resource = this.getNodeParameter("resource", itemIndex) as string;
        const operation = this.getNodeParameter(
          "operation",
          itemIndex,
        ) as string;
        let results: IDataObject[];
        if (resource === "document" && operation === "uploadAndExtract") {
          results = [
            await uploadAndExtract(
              this,
              itemIndex,
              this.getNodeParameter("tableId", itemIndex) as string,
            ),
          ];
        } else if (resource === "job" && operation === "get") {
          const id = Number(this.getNodeParameter("jobId", itemIndex));
          if (!Number.isSafeInteger(id) || id < 1)
            throw new NodeOperationError(
              this.getNode(),
              "Job ID must be a positive integer",
              { itemIndex },
            );
          results = [(await apiRequest(this, `/jobs/${id}`)) as IDataObject];
        } else if (resource === "table" && operation === "get") {
          results = [
            (await apiRequest(
              this,
              `/tables/${encodeURIComponent(this.getNodeParameter("tableId", itemIndex) as string)}`,
            )) as IDataObject,
          ];
        } else if (resource === "table" && operation === "getMany") {
          results = (await apiRequest(this, "/tables")) as IDataObject[];
          if (!this.getNodeParameter("returnAll", itemIndex))
            results = results.slice(
              0,
              this.getNodeParameter("limit", itemIndex) as number,
            );
        } else if (resource === "row" && operation === "getMany") {
          const tableId = this.getNodeParameter("tableId", itemIndex) as string;
          const returnAll = this.getNodeParameter(
            "returnAll",
            itemIndex,
          ) as boolean;
          const limit = returnAll
            ? Infinity
            : (this.getNodeParameter("limit", itemIndex) as number);
          if (!returnAll && (!Number.isSafeInteger(limit) || limit < 1))
            throw new NodeOperationError(
              this.getNode(),
              "Limit must be a positive integer",
              { itemIndex },
            );
          const options = this.getNodeParameter(
            "rowOptions",
            itemIndex,
            {},
          ) as IDataObject;
          results = [];
          let page = 1;
          // Page offsets depend on pageSize, so keep it stable across requests.
          const pageSize = Math.min(200, limit);
          while (results.length < limit) {
            const response = (await apiRequest(this, "/rows/search", {
              method: "POST",
              body: {
                table_id: tableId,
                page,
                pageSize,
                filters: options.documentId
                  ? [
                      {
                        column: "document_record_id",
                        op: "eq",
                        value: options.documentId,
                      },
                    ]
                  : [],
              },
            })) as IDataObject;
            const rows = response.results as IDataObject[];
            results.push(...rows.slice(0, limit - results.length));
            if (!rows.length || page >= Number(response.pageCount)) break;
            page++;
          }
        } else {
          throw new NodeOperationError(
            this.getNode(),
            "Select a supported resource and operation",
            { itemIndex },
          );
        }
        if (
          ["job", "table"].includes(resource) &&
          this.getNodeParameter("simplify", itemIndex, true)
        ) {
          const fields =
            resource === "job"
              ? [
                  "id",
                  "status",
                  "table_id",
                  "projects_id",
                  "created_at",
                  "updated_at",
                ]
              : ["id", "name", "slug", "description", "columns"];
          results = results.map((result) =>
            Object.fromEntries(
              fields
                .filter((field) => result[field] !== undefined)
                .map((field) => [field, result[field]]),
            ),
          );
        }
        output.push(
          ...results.map((json) => ({ json, pairedItem: { item: itemIndex } })),
        );
      } catch (error) {
        if (this.continueOnFail()) {
          output.push({
            json: { error: (error as Error).message },
            pairedItem: { item: itemIndex },
          });
          continue;
        }
        throw new NodeOperationError(this.getNode(), error as Error, {
          itemIndex,
        });
      }
    }
    return [output];
  }
}
