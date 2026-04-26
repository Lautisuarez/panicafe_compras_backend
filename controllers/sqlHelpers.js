function bitToBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (Buffer.isBuffer(value)) return value[0] === 1;
  return Boolean(value);
}

module.exports = { bitToBoolean };
