import fs from 'fs';

// External game archives are physical files, even when this tool runs in Electron.
// Keep ordinary fs for reading the tool's own ASAR-packaged modules/assets.
const physicalFs: typeof fs = process.versions.electron ? require('original-fs') : fs;
export default physicalFs;
