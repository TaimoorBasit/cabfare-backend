const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');

function fixFiles(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            fixFiles(fullPath);
        } else if (fullPath.endsWith('.ts')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes("from 'express'")) {
                content = content.replace(/import\s+\{.*\}\s+from\s+'express';?/g, "type Request = any; type Response = any; type NextFunction = any;");
                content = content.replace(/import\s+express\s+from\s+'express';?/g, "");
                fs.writeFileSync(fullPath, content);
                console.log('Fixed', fullPath);
            }
        }
    }
}

fixFiles(srcDir);
console.log('Done');
