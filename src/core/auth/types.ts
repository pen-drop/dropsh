import type { HttpRequest } from "../http.js";

export interface AuthAdapter {
  apply(req: HttpRequest): Promise<HttpRequest>;
}
