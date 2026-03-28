class Response {
  // Recursively replace hyphens in object keys with underscores to avoid
  // protobuf/gRPC serialization errors (field names cannot contain '-').
  // This is conservative: we only transform keys, not string values.
  private static sanitizeKeys(value: any): any {
    if (value == null) return value;
    if (Array.isArray(value)) return value.map((v) => this.sanitizeKeys(v));
    if (typeof value === 'object') {
      return Object.keys(value).reduce((acc: any, key: string) => {
        const safeKey = key.includes('-') ? key.replace(/-/g, '_') : key;
        acc[safeKey] = this.sanitizeKeys(value[key]);
        if (safeKey !== key) {
          // Minimal log for debugging — avoids bringing in logger dependency
          // in this small helper.

          console.warn(
            `Response.sanitizeKeys: renamed metadata key '${key}' -> '${safeKey}'`,
          );
        }
        return acc;
      }, {});
    }
    return value;
  }
  static success(
    data: any,
    message = 'Success',
    statusCode = 200,
    reasonStatusCode = 'OK',
  ) {
    return {
      message,
      statusCode,
      reasonStatusCode,
      metadata: data,
    };
  }

  static error(
    message = 'Error',
    statusCode = 500,
    reasonStatusCode = 'Internal Server Error',
    data: any = null,
  ) {
    return {
      message,
      statusCode,
      reasonStatusCode,
      metadata: data,
    };
  }

  static notFound(message = 'Not Found', data: any = null) {
    return this.error(message, 404, 'Not Found', data);
  }

  static badRequest(message = 'Bad Request', data: any = null) {
    return this.error(message, 400, 'Bad Request', data);
  }

  static unauthorized(message = 'Unauthorized', data: any = null) {
    return this.error(message, 401, 'Unauthorized', data);
  }

  static forbidden(message = 'Forbidden', data: any = null) {
    return this.error(message, 403, 'Forbidden', data);
  }

  static conflict(message = 'Conflict', data: any = null) {
    return this.error(message, 409, 'Conflict', data);
  }

  static serviceUnavailable(message = 'Service Unavailable', data: any = null) {
    return this.error(message, 503, 'Service Unavailable', data);
  }

  static timeout(message = 'Request Timeout', data: any = null) {
    return this.error(message, 408, 'Request Timeout', data);
  }

  static created(data: any, message = 'Resource Created') {
    return this.success(data, message, 201, 'Created');
  }

  static noContent(message = 'No Content') {
    return this.success(null, message, 204, 'No Content');
  }

  static accepted(data: any, message = 'Request Accepted') {
    return this.success(data, message, 202, 'Accepted');
  }

  static resetContent(message = 'Reset Content') {
    return this.success(null, message, 205, 'Reset Content');
  }

  static partialContent(data: any, message = 'Partial Content') {
    return this.success(data, message, 206, 'Partial Content');
  }
}

export { Response };
