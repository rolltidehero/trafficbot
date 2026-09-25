const { execFileSync } = require('node:child_process');
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0');
const forbidden = files.filter(path => /(^|\/)(node_modules|sessions|logs)\//.test(path) || /(^|\/)\.env($|\.(?!example$))/.test(path));
if (forbidden.length || !files.includes('package-lock.json')) {
  console.error(`Generated/sensitive paths tracked: ${forbidden.length}; lockfile tracked: ${files.includes('package-lock.json')}`);
  process.exit(1);
}
