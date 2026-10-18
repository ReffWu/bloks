import { useEffect, useRef } from "react";
import { observeCommittedSettings } from "./settings-client.ts";
import type { DeviceSetting, DeviceValue } from "./settings-observation.ts";

/** Lets an inspection read this component's committed state, including a
 * choice a failed storage write did not save. Registered once on mount;
 * a render only updates a ref, so nothing runs or is sent until asked.
 * Reporting never becomes the preference's source of truth. */
export function useSettingsObservation(values: Partial<Record<DeviceSetting, DeviceValue>>) {
  const latest = useRef(values);
  latest.current = values;
  useEffect(() => observeCommittedSettings(() => latest.current), []);
}
