import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { F6180_49A_Doc, DailyInspection_Doc } from "./templates";
import { uploadToBucket } from "../../storage";
import type { FormType } from "@contract/contract";

export async function renderFormPdf(
  ticket_id: number,
  form_type: FormType,
  payload: Record<string, unknown>
): Promise<string> {
  let element: React.ReactElement;
  switch (form_type) {
    case "F6180_49A":
      element = React.createElement(F6180_49A_Doc, { p: payload as any });
      break;
    case "DAILY_INSPECTION_229_21":
      element = React.createElement(DailyInspection_Doc, { p: payload as any });
      break;
  }
  const buf = await renderToBuffer(element as any);
  const storageKey = `${ticket_id}/forms/${form_type}.pdf`;
  return uploadToBucket(storageKey, buf, "application/pdf");
}
