// Captura la interfaz local de Argo CD. Lee la clave inicial de Kubernetes
// en memoria y nunca la imprime ni la guarda en el repositorio.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 19337;
const profile = path.join(process.env.TEMP, 'edge-argocd-evidence');
const screenshot = path.join(__dirname, '..', 'informe', 'captura-argocd.png');
const pageUrl = 'https://127.0.0.1:18081/applications/argocd/cooperativa-web';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const browser = spawn(edge, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--ignore-certificate-errors', '--no-first-run',
    '--remote-allow-origins=*', `--remote-debugging-port=${port}`,
    '--window-size=1440,1000', `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
  try {
    let target;
    for (let i = 0; i < 30; i++) {
      try {
        target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })).json();
        break;
      } catch { await sleep(500); }
    }
    if (!target?.webSocketDebuggerUrl) throw new Error('No se pudo abrir Argo CD en Edge');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let nextId = 1;
    const pending = new Map();
    ws.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
      }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await sleep(3000);
    const page = await evaluate('({url:location.href, text:document.body.innerText.slice(0,600), inputs:[...document.querySelectorAll("input")].map(x=>({type:x.type,placeholder:x.placeholder})), buttons:[...document.querySelectorAll("button")].map(x=>x.innerText).slice(0,10)})');
    if (process.argv.includes('--inspect')) { console.log(JSON.stringify(page, null, 2)); return; }

    if (page.inputs.some((input) => input.type === 'password')) {
      const encoded = execFileSync('kubectl', [
        'get', 'secret', 'argocd-initial-admin-secret', '-n', 'argocd',
        '-o', 'jsonpath={.data.password}'
      ], { encoding: 'utf8' }).trim();
      const password = Buffer.from(encoded, 'base64').toString('utf8');
      const login = await evaluate(`(async () => {
        const inputs = [...document.querySelectorAll('input')];
        const username = inputs.find(x => x.type === 'text' || x.name.toLowerCase().includes('user'));
        const secret = inputs.find(x => x.type === 'password');
        for (const [input, value] of [[username, 'admin'], [secret, ${JSON.stringify(password)}]]) {
          if (!input) return 'Falta un campo del formulario';
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const button = [...document.querySelectorAll('button')].find(x => /sign in|log in|login/i.test(x.innerText));
        if (!button) return 'Falta botón de acceso';
        button.click();
        return 'Acceso enviado';
      })()`);
      if (login !== 'Acceso enviado') throw new Error(login);
      await sleep(5000);
    }
    const after = await evaluate('({url:location.href, text:document.body.innerText.slice(0,1000)})');
    if (!after.text.includes('cooperativa-web') || !after.text.includes('Synced')) {
      throw new Error('La aplicación no aparece en la interfaz: ' + after.text.slice(0,250));
    }
    const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(screenshot, Buffer.from(capture.data, 'base64'));
    console.log(screenshot);
  } finally {
    browser.kill();
    await sleep(500);
    const tempRoot = path.resolve(process.env.TEMP);
    const profilePath = path.resolve(profile);
    if (!profilePath.startsWith(tempRoot + path.sep)) {
      throw new Error('El perfil temporal está fuera de TEMP');
    }
    fs.rmSync(profilePath, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
