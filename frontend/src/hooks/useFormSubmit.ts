import { useState } from "react";
import { getErrorMessage } from "../api/client";

interface FormSubmitResult {
  submitting: boolean;
  error: string | null;
  /** For call-site validation errors that share the same banner (e.g. 파일 검증). */
  setError: (error: string | null) => void;
  submit: (action: () => Promise<void>) => Promise<void>;
}

// Shared submit pattern for forms: clears the error, runs the action with a
// `submitting` flag, and maps failures to a user-facing message. Pass a plain
// fallback string (server-provided ApiError messages pass through), or a
// mapper function for custom per-status messages (e.g. 로그인 403 휴면 안내).
export function useFormSubmit(errorMessage: string | ((err: unknown) => string)): FormSubmitResult {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: () => Promise<void>): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(typeof errorMessage === "function" ? errorMessage(err) : getErrorMessage(err, errorMessage));
    } finally {
      setSubmitting(false);
    }
  }

  return { submitting, error, setError, submit };
}
