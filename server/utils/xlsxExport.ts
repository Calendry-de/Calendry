import ExcelJS from 'exceljs';

/** One sheet: a name, its columns in order, and the rows to fill them from. */
export interface XlsxSheet {
    name: string;
    columns: { header: string; key: string; width?: number }[];
    rows: Record<string, unknown>[];
}

/**
 * A cell value ExcelJS accepts as-is. Everything else (an array, a plain
 * object) is stringified — ExcelJS has no representation for either and
 * silently writes `[object Object]` if handed one directly, which is worse
 * than a readable JSON string in the one cell a person will actually open.
 */
function cellValue(value: unknown): string | number | boolean | Date | null {
    if (value === null || value === undefined) {
        return null;
    }

    if (value instanceof Date || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    return JSON.stringify(value);
}

/**
 * One `.xlsx` workbook, one sheet per data category — the shape every export
 * route in issue #84 shares (`GET /api/me/export`, `GET
 * /api/person-export/:id`, `GET /api/tenant/export`). A thin wrapper over
 * ExcelJS rather than a bespoke writer: hand-rolling the OOXML format is not
 * this app's job, and ExcelJS is the one place that complexity should live.
 *
 * Sheet names are truncated to Excel's 31-character cap — callers pick names
 * short enough that this never bites in practice, but a silently-thrown
 * workbook write is a worse failure than a slightly clipped tab name.
 */
export async function buildXlsxWorkbook(sheets: XlsxSheet[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Calendry';
    workbook.created = new Date();

    for (const sheet of sheets) {
        const worksheet = workbook.addWorksheet(sheet.name.slice(0, 31));
        worksheet.columns = sheet.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 24 }));

        for (const row of sheet.rows) {
            const normalized: Record<string, unknown> = {};

            for (const column of sheet.columns) {
                normalized[column.key] = cellValue(row[column.key]);
            }

            worksheet.addRow(normalized);
        }

        worksheet.getRow(1).font = { bold: true };
    }

    const buffer = await workbook.xlsx.writeBuffer();

    return Buffer.from(buffer);
}
