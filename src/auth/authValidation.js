export function validateAuthFields(fields, register = false) {
  const errors = {};
  if (register) {
    if (!/^[a-z0-9_]{3,32}$/i.test(fields.username.trim())) errors.username = 'Use 3–32 lowercase letters, numbers, or underscores.';
    if (fields.email.trim().length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.trim())) errors.email = 'Enter a valid email address.';
    if (fields.password.length < 10) errors.password = 'Use at least 10 characters.';
    if (fields.password !== fields.confirmPassword) errors.confirmPassword = 'Passwords do not match.';
  } else {
    if (!fields.identifier.trim() || fields.identifier.trim().length > 320) errors.identifier = 'Enter your email or username.';
    if (!fields.password) errors.password = 'Enter your password.';
  }
  if (fields.password.length > 128) errors.password = 'Use no more than 128 characters.';
  return errors;
}
