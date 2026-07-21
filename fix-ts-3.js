const fs = require('fs');
const path = require('path');
const bPath = (p) => path.join('c:/Users/Taimoor/Desktop/C2O/Admin Fare Calculator/Admin/backend/src', p);

// 1. services/user.ts
let user = fs.readFileSync(bPath('services/user.ts'), 'utf8');
user = user.replace(/export type User/g, 'type User'); // reset
user = user.replace(/type User =/g, 'export type User ='); // fix
fs.writeFileSync(bPath('services/user.ts'), user);

// 2. auth/auth.ts
let auth = fs.readFileSync(bPath('auth/auth.ts'), 'utf8');
if (!auth.includes('findUserById')) {
  auth = auth.replace("import { User } from '../services/user';", "import { User, findUserById } from '../services/user';");
  fs.writeFileSync(bPath('auth/auth.ts'), auth);
}

// 3. auth controllers & users controller
const toFix = ['auth_loginController.ts', 'auth_meController.ts', 'auth_registerController.ts', 'usersController.ts'];
toFix.forEach(f => {
  let p = bPath('controllers/' + f);
  let c = fs.readFileSync(p, 'utf8');
  c = c.replace(/res\.status\(\d+\)\.json\(([^,]+),\s*\{\s*status:\s*(\d+)\s*\}\)/g, 'res.status($2).json($1)');
  c = c.replace(/res\.json\(([^,]+),\s*\{\s*status:\s*(\d+)\s*\}\)/g, 'res.status($2).json($1)');
  // handle multiline
  c = c.replace(/res\.status\(200\)\.json\([\s\S]*?status:\s*\d+[\s\S]*?\)/g, (match) => {
    // just strip the status argument
    return match.replace(/,\s*\{\s*status:\s*\d+\s*\}/, '');
  });
  // handle `return res.status(200).json({ error: 'Invalid credentials' }, { status: 401 });`
  c = c.replace(/res\.status\(\d+\)\.json\((.*?),\s*\{\s*status:\s*(\d+)\s*\}\)/g, 'res.status($2).json($1)');
  fs.writeFileSync(p, c);
});

// 4. database/db.ts
let db = fs.readFileSync(bPath('database/db.ts'), 'utf8');
db = db.replace(/b\.quote\?\.result/g, '(b.quote as any)?.result');
fs.writeFileSync(bPath('database/db.ts'), db);

console.log('Fixed remaining errors.');
