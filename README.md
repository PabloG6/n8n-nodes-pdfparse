# n8n nodes for PdfParse

Use [PdfParse](https://pdfparse.net) in n8n to upload PDFs, extract structured data into your tables, check extraction jobs, and pass saved rows to other apps.

**Release status:** preparing the first npm release and n8n verification submission. This package is not yet published or verified. An npm release alone does not make a node available on n8n Cloud.

## Installation

After the first npm release, self-hosted n8n users can install `n8n-nodes-pdfparse` from **Settings → Community Nodes → Install**. See [n8n community node installation](https://docs.n8n.io/integrations/community-nodes/installation/). On n8n Cloud, the node must first be approved through n8n's community verification process.

For local development before publication, clone this repository, use Node.js 24, and run:

```sh
npm ci --ignore-scripts
npm run dev
```

The official n8n development tool starts a local n8n instance with the node loaded. Docker or Podman may be required by the current development tool. No project credentials are included in the repository or example workflow.

## Credentials

1. [Create a PdfParse account](https://pdfparse.net/getting-started/create-account), create a project, and create an extraction table.
2. In that project, open **API Keys** and create a project API key with the permissions needed by your workflow: tables and rows read access for retrieval; document upload and job creation access for extraction.
3. Create a **PdfParse API** credential in n8n and paste the key into **Project API Key**. The connection test lists the project's tables.

Each connection can access only the project that owns its key. Use a separate credential for each project. Store keys only in n8n credentials, never in node text parameters or workflow JSON. Reconnect when a key expires or is revoked.

These nodes call the project-key [REST API](https://pdfparse.net/docs/api-reference). PdfParse's [MCP OAuth endpoint](https://pdfparse.net/docs/mcp) is a separate interface; its OAuth tokens cannot be substituted for a project API key here.

## Operations

| Resource | Operation | Result |
| --- | --- | --- |
| Document | Upload and Extract | Uploads an input PDF binary into an existing table and starts an asynchronous extraction job |
| Extraction Job | Get | Returns a job's current status; disable Simplify to include batches and the complete response |
| Row | Get Many | Returns saved table rows as separate n8n items, with pagination and an optional source document filter |
| Table | Get | Returns a table and its extraction schema |
| Table | Get Many | Returns the connected project's tables as separate n8n items |

Table selectors load the connected project's tables. You can also supply an ID using an expression. **Return All** paginates row retrieval; otherwise **Limit** bounds the number of returned items. This package has no trigger node: use n8n's Schedule Trigger, or use a Wait and If loop when following a job started by the workflow.

## Tutorial from PDF to invoice rows

Use the included [example workflow](examples/extract-invoice.json). It downloads the public sample invoice, uploads it, waits for extraction, checks job status, and retrieves that document's saved rows. It has a bounded retry loop and a separate terminal path for incomplete or failed jobs.

### Prepare your table

Create an **Invoices** table in PdfParse with these extraction fields. Keep the automatic integer `id` column.

| Field | Type | Extraction instruction |
| --- | --- | --- |
| `invoice_number` | Text | Extract the invoice identifier |
| `supplier` | Text | Extract the supplier business name |
| `currency` | Text | Extract the three-letter currency code |
| `total` | Number | Extract the final invoice total including tax |

### Run the workflow

1. Import `examples/extract-invoice.json` into n8n.
2. Select your **PdfParse API** credential in each PdfParse node.
3. Select your **Invoices** table in **Upload invoice**. **Get invoice rows** uses that table automatically through an expression.
4. Execute the workflow manually. **Download sample invoice** fetches [the synthetic PDF](https://pdfparse.net/blog/api-examples/invoice.pdf) as binary field `data`.
5. **Upload invoice** uses **Document → Upload and Extract** with input binary field `data`. Its result includes `job_id`, `document_id`, `status`, `table_id`, and `filename`.
6. The workflow waits 15 seconds between checks, for at most 20 checks. **Get job** reads the job ID; the If nodes route completed jobs to **Get invoice rows**, retry active jobs, and stop failed or timed-out jobs on **Needs review**. That review path is not a success result.
7. Inspect the returned rows. Expected sample fields are `HOS-2026-1042`, `Harbor Office Supply`, `USD`, and numeric `70.2` (which may display as `70.20`). Extraction results should be reviewed against the source PDF.
8. Connect a destination such as Google Sheets after **Get invoice rows**, and map the invoice fields. Keep `document_record_id` so you can trace each row to its PDF.

The sample workflow is inactive by default and contains no credentials. Processing uses your PdfParse extraction allowance. Configure and test a destination before enabling any scheduled workflow.

## Important behavior

- **Extraction is asynchronous.** Upload and Extract returns job and document identifiers, not invoice fields. A completed job can include partially unsuccessful documents; inspect the full job and actual rows when correctness matters.
- **Input is binary PDF data, at most 8 MiB per operation.** Download a PDF with n8n's HTTP Request node using response format **File**, or use another binary-producing node. A URL string, HTML sharing page, or renamed image is not a PDF binary.
- **Retries can create another upload.** The job request is idempotent for the particular uploaded document, but replaying the entire Upload and Extract operation creates a new document. Check your project before replaying after a timeout. Downstream consumers should avoid duplicate writes when workflows are replayed.
- **Rows are individual items.** Child tables can contain multiple rows for the same document. Row retrieval returns all matching rows within your chosen limit; it does not approve the extracted values.
- **Plan and rate limits apply.** Keys currently have a daily request allowance shared across their workflows. Follow the service's returned limits and choose a sensible schedule. Avoid tight polling loops.
- **No automatic webhook subscriptions.** This version does not create endpoints or require a public callback URL.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Connection rejected | Key belongs to the correct project, is unexpired, and permits listing tables |
| Table missing | Create it in the project belonging to this credential, then refresh options |
| Missing binary input | Download as File and use the correct binary field name, normally `data` |
| PDF rejected | Valid PDF signature, filename ending in `.pdf`, size no more than 8 MiB |
| Job queued but no rows | Wait for processing, check job status and batches, and confirm the table selection |
| No matching rows | Use the returned `document_id` as Source Document ID; it is not the job ID |
| Request throttled | Wait for the API allowance to reset; reduce polling and inspect other workflows using this key |

## Development and verification

Scaffolded with the official `@n8n/create-node` tool. The upload flow needs dependent TUS creation, binary transfer, and job creation calls, so this node uses the programmatic style. There are no runtime dependencies, environment-variable reads, or direct filesystem operations in the shipped node code.

```sh
npm ci --ignore-scripts
npm run lint
npm test
npm pack --dry-run --ignore-scripts
```

The publish workflow validates the code and publishes version tags through GitHub Actions with npm provenance. npm trusted publishing must be configured for `PabloG6/n8n-nodes-pdfparse`, workflow `publish.yml`, before a release is dispatched. The first npm package registration may require a separate owner authentication step before trusted publishing can be configured.

For verification, n8n's reviewers need a published package with provenance, public source, authentication instructions, and a working example. [Submission requirements](https://docs.n8n.io/integrations/community-nodes/building-community-nodes.md).

[PdfParse website](https://pdfparse.net) · [API reference](https://pdfparse.net/docs/api-reference) · [Contact](https://pdfparse.net/contact) · [Report a node issue](https://github.com/PabloG6/n8n-nodes-pdfparse/issues)

## License

[MIT](LICENSE) for this integration package. PdfParse is a hosted service with its own [terms](https://pdfparse.net/terms-and-conditions) and [privacy policy](https://pdfparse.net/privacy).
