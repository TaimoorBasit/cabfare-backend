const fs = require('fs');
const path = require('path');

const controllersDir = path.join(__dirname, 'src', 'controllers');
const files = fs.readdirSync(controllersDir);

files.forEach(file => {
    if (!file.endsWith('.ts')) return;
    const filePath = path.join(controllersDir, file);
    let content = fs.readFileSync(filePath, 'utf8');

    // Remove dynamic export
    content = content.replace(/export const dynamic = 'force-dynamic';\n?/g, '');

    // Fix GET() to getHandler(req, res)
    content = content.replace(/export async function GET\(\) \{/g, 'export const getHandler = async (req: Request, res: Response) => {');

    // Fix `export const  = async (req: Request, res: Response) => {`
    // We will assign them names based on their content
    let postCount = 0;
    content = content.replace(/export const\s*=\s*async\s*\(\s*req:\s*Request,\s*res:\s*Response\s*\)\s*=>\s*\{/g, (match, offset, string) => {
        // Simple heuristic: if it contains push() or create, it's POST. If it contains findIndex or update, it's PUT. If it contains filter or delete, it's DELETE.
        const body = string.substring(offset, offset + 300);
        if (body.includes('.filter(') || body.includes('delete ')) return 'export const deleteHandler = async (req: Request, res: Response) => {';
        if (body.includes('.findIndex(') || body.includes('update')) return 'export const putHandler = async (req: Request, res: Response) => {';
        return 'export const postHandler = async (req: Request, res: Response) => {';
    });

    // Fix `await req.body` to `req.body`
    content = content.replace(/await req\.body/g, 'req.body');

    // Fix URL searchParams
    content = content.replace(/const \{ searchParams \} = new URL\(req\.url\);\n\s*const (\w+) = searchParams\.get\('([^']+)'\);/g, 'const $1 = req.query.$2 as string;');

    fs.writeFileSync(filePath, content);
});
console.log('Fixed controllers.');
