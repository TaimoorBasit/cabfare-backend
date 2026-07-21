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
            let modified = false;

            if (content.includes('getDatabase()')) {
                content = content.replace(/getDatabase\(\)/g, "getDatabase(req.env)");
                modified = true;
            }
            if (content.includes('authenticateUser(email, password)')) {
                content = content.replace(/authenticateUser\(email,\s*password\)/g, "authenticateUser(email, password, req.env)");
                modified = true;
            }
            if (content.includes('createUser(')) {
                // Not standard regex, I will just manually fix controllers if there are few. 
            }
            if (content.includes('getCurrentUser(')) {
                content = content.replace(/getCurrentUser\((.*?)\)/g, "getCurrentUser($1, req.env)");
                modified = true;
            }
            
            if (modified) {
                fs.writeFileSync(fullPath, content);
                console.log('Fixed', fullPath);
            }
        }
    }
}

fixFiles(srcDir);
console.log('Done');
