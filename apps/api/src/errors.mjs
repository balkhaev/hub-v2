export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {unknown=} details
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** @param {unknown} error */
export function normalizeError(error) {
  if (error instanceof HttpError) {
    return error;
  }
  if (error instanceof TypeError || error instanceof URIError) {
    return new HttpError(400, "validation_error", error.message);
  }

  console.error(error);
  return new HttpError(500, "internal_error", "Unexpected server error");
}
