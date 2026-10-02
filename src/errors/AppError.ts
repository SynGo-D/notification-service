export class AppError extends Error {
    constructor(
        message: string,
        public readonly statusCode = 500,
    ) {
        super(message);
        this.name = new.target.name;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
