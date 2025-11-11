// Lightweight test for src/pybridge.js -> pyResolve
(async () => {
  try {
    const path = require('path');
    const pb = require(path.join(__dirname, '..', 'src', 'pybridge'));
    if (!pb || typeof pb.pyResolve !== 'function') {
      console.error('pybridge.pyResolve not found');
      process.exit(2);
    }

    console.log('Calling pyResolve("never gonna give you up")...');
    const res = await pb.pyResolve('never gonna give you up');
    console.log('RESULT:');
    console.log(JSON.stringify(res, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Error running pybridge test:', err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
