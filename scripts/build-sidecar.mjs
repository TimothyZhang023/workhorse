import { execSync } from 'node:child_process';
import { copyFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const tauriDir = join(rootDir, 'src-tauri');
const sidecarDir = join(tauriDir, 'sidecar');

function run(command) {
    console.log(`Running: ${command}`);
    execSync(command, { stdio: 'inherit', cwd: rootDir });
}

async function build() {
    if (!existsSync(sidecarDir)) {
        mkdirSync(sidecarDir, { recursive: true });
    }

    // 1. Bundle server
    console.log('Bundling server with ncc...');
    run('npx ncc build server.js -o dist-server -m');
    copyFileSync(join(rootDir, 'dist-server', 'index.js'), join(rootDir, 'dist-server.cjs'));

    // 2. Generate SEA config dynamically
    const seaConfig = {
        main: "dist-server.cjs",
        output: "sea-prep.blob",
        disableExperimentalSEAWarning: true
    };
    writeFileSync(join(rootDir, 'sea-config.json'), JSON.stringify(seaConfig, null, 2));

    // 3. Generate SEA blob
    console.log('Generating SEA blob...');
    run('node --experimental-sea-config sea-config.json');

    // 4. Create the executable
    // Use realpath to ensure we are not copying a symlink
    const nodePath = realpathSync(process.execPath);
    const targetTriple = execSync('rustc -Vv | grep host | cut -d " " -f 2', { encoding: 'utf8' }).trim();
    const binaryName = `workhorse-server-${targetTriple}${process.platform === 'win32' ? '.exe' : ''}`;
    const outputPath = join(sidecarDir, binaryName);

    console.log(`Creating sidecar binary: ${binaryName}`);
    copyFileSync(nodePath, outputPath);

    // 5. Fix for macOS: Remove signature before injection
    if (process.platform === 'darwin') {
        console.log('Removing macOS binary signature for injection...');
        try { execSync(`codesign --remove-signature ${outputPath}`); } catch (e) {
            console.warn('Signature removal failed, might already be unsigned.');
        }
    }

    // 6. Inject the blob
    console.log('Injecting SEA blob...');
    const fuse = "NODE_SEA_FUSE_f14658410194511a1228e3d92fb9b00c";
    let postjectCmd = `npx postject ${outputPath} NODE_SEA_BLOB sea-prep.blob --sentinel-fuse ${fuse}`;
    if (process.platform === 'darwin') {
        postjectCmd += ' --macho-segment-name NODE_SEA';
    }
    run(postjectCmd);

    if (process.platform !== 'win32') {
        chmodSync(outputPath, 0o755);
    }

    console.log('Sidecar build complete!');
}

build().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
});
