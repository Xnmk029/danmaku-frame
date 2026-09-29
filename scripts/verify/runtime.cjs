const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const screenshots=path.join(root,'tmp','qa');fs.mkdirSync(screenshots,{recursive:true});
function playwright(){
 const candidates=[process.env.PLAYWRIGHT_MODULE,'playwright',path.join(require('node:os').homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules','playwright')].filter(Boolean);
 for(const candidate of candidates){try{return require(candidate);}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}}
 throw new Error('Browser checks need Playwright: set PLAYWRIGHT_MODULE or install playwright locally (npm install --no-save --package-lock=false playwright).');
}
module.exports={root,screenshots,get chromium(){return playwright().chromium;}};
