export type ApiCommonErrorCode = "bad_request" | "unauthenticated" | "forbidden" | "internal_error";

export type ApiErrorResponse<Code extends string = ApiCommonErrorCode> = {
  status: "error";
  code: Code;
  message: string;
};
