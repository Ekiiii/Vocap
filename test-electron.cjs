const electron = require('electron');
console.log('App type:', typeof electron.app);
if (electron.app) {
    console.log('Success! Electron app is defined.');
    process.exit(0);
} else {
    console.log('Keys:', Object.keys(electron));
    process.exit(1);
}
