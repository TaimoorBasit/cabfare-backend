const fs = require('fs');
const path = require('path');
const bPath = (p) => path.join('c:/Users/Taimoor/Desktop/C2O/Admin Fare Calculator/Admin/backend/src', p);

// 1. Fix user.ts export
const userPath = bPath('services/user.ts');
let userContent = fs.readFileSync(userPath, 'utf8');
if (userContent.includes('export interface User')) {
  // Already good
} else if (userContent.includes('interface User')) {
  userContent = userContent.replace('interface User', 'export interface User');
} else {
  userContent = userContent.replace(/type User =/g, 'export type User =');
}
fs.writeFileSync(userPath, userContent);

// 2. Fix admin_route-templatesController.ts
const rtPath = bPath('controllers/admin_route-templatesController.ts');
let rtContent = fs.readFileSync(rtPath, 'utf8');
rtContent = rtContent.replace(/export const putHandler = async/g, 'export const tempHandler = async');
let rtMatches = [...rtContent.matchAll(/export const tempHandler/g)];
if (rtMatches.length === 2) {
  rtContent = rtContent.substring(0, rtMatches[0].index) + 'export const putHandler' + rtContent.substring(rtMatches[0].index + 24);
  rtContent = rtContent.substring(0, rtMatches[1].index) + 'export const deleteHandler' + rtContent.substring(rtMatches[1].index + 24);
}
fs.writeFileSync(rtPath, rtContent);

// 3. Fix auth controllers NextResponse
const dirs = ['controllers'];
dirs.forEach(d => {
  const cPath = bPath(d);
  const files = fs.readdirSync(cPath);
  files.forEach(f => {
    if (!f.endsWith('.ts')) return;
    const p = path.join(cPath, f);
    let c = fs.readFileSync(p, 'utf8');
    c = c.replace(/NextResponse\.json/g, 'res.status(200).json');
    c = c.replace(/res\.json\(([^,]+),\s*\{\s*status:\s*(\d+)\s*\}\)/g, 'res.status($2).json($1)');
    c = c.replace(/res\.status\(\d+\)\.json\(([^,]+),\s*\{\s*status:\s*(\d+)\s*\}\)/g, 'res.status($2).json($1)');
    fs.writeFileSync(p, c);
  });
});

// 4. Fix db.ts
const dbPath = bPath('database/db.ts');
let dbContent = fs.readFileSync(dbPath, 'utf8');
dbContent = dbContent.replace(/b\.quote\?\.result/g, '(b.quote as any)?.result');
dbContent = dbContent.replace(/b\.journey\?\.vehicleId/g, '(b.journey as any)?.vehicleId');
fs.writeFileSync(dbPath, dbContent);

console.log('Fixed more errors.');
