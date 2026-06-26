const TAG_DEFAULT = 'app';
let DEV_MODE = true;

function _isDev() {
  try { return DEV_MODE && wx.getStorageSync('__devLog') !== false; }
  catch (e) { return DEV_MODE; }
}

function _emit(level, tag, args) {
  const prefix = `[${tag}]`;
  if (level === 'debug') {
    if (!_isDev()) return;
    return console.debug(prefix, ...args);
  }
  if (level === 'info')  return console.log(prefix, ...args);
  if (level === 'warn')  return console.warn(prefix, ...args);
  if (level === 'error') return console.error(prefix, ...args);
}

function makeLogger(tag) {
  return {
    debug: (...a) => _emit('debug', tag, a),
    info:  (...a) => _emit('info',  tag, a),
    warn:  (...a) => _emit('warn',  tag, a),
    error: (...a) => _emit('error', tag, a),
  };
}

module.exports = {
  debug: (...a) => _emit('debug', TAG_DEFAULT, a),
  info:  (...a) => _emit('info',  TAG_DEFAULT, a),
  warn:  (...a) => _emit('warn',  TAG_DEFAULT, a),
  error: (...a) => _emit('error', TAG_DEFAULT, a),
  for: makeLogger,
  setDev: (v) => { DEV_MODE = !!v; },
};