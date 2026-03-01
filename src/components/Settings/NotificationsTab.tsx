import { useEffect } from "react";
import { usePersistedBoolean } from "../../hooks/usePersistedState";
import { updateNotificationSettings } from "../../lib/notifications";
import { Checkbox } from "../ui/checkbox";
import { sectionHeadingClass } from "./shared";

const NOTIF_TOGGLES: {
  key: string;
  settingsKey: "on_complete" | "on_error" | "on_waiting";
  label: string;
  description: string;
}[] = [
  {
    key: "notifications_on_complete",
    settingsKey: "on_complete",
    label: "Session Complete",
    description: "Notify when an agent session finishes its task.",
  },
  {
    key: "notifications_on_error",
    settingsKey: "on_error",
    label: "Session Error",
    description: "Notify when an agent session encounters an error.",
  },
  {
    key: "notifications_on_waiting",
    settingsKey: "on_waiting",
    label: "Input Needed",
    description: "Notify when an agent is waiting for user input.",
  },
];

export function NotificationsTab() {
  const [enabled, setEnabled] = usePersistedBoolean(
    "notifications_enabled",
    true,
  );
  const [onComplete, setOnComplete] = usePersistedBoolean(
    "notifications_on_complete",
    true,
  );
  const [onError, setOnError] = usePersistedBoolean(
    "notifications_on_error",
    true,
  );
  const [onWaiting, setOnWaiting] = usePersistedBoolean(
    "notifications_on_waiting",
    true,
  );

  // Sync cached settings in the notification module whenever toggles change
  useEffect(() => {
    updateNotificationSettings({
      enabled,
      on_complete: onComplete,
      on_error: onError,
      on_waiting: onWaiting,
    });
  }, [enabled, onComplete, onError, onWaiting]);

  const toggles = [
    { value: onComplete, setter: setOnComplete, ...NOTIF_TOGGLES[0] },
    { value: onError, setter: setOnError, ...NOTIF_TOGGLES[1] },
    { value: onWaiting, setter: setOnWaiting, ...NOTIF_TOGGLES[2] },
  ];

  return (
    <div className="flex flex-col gap-7">
      {/* Master toggle */}
      <section>
        <div className={sectionHeadingClass}>Notifications</div>
        <label className="flex items-start gap-2.5 p-2.5 rounded-[var(--radius-element)] bg-background border border-border cursor-pointer max-w-[420px]">
          <Checkbox
            checked={enabled}
            onCheckedChange={(checked) => setEnabled(checked === true)}
            className="mt-0.5"
          />
          <div>
            <div className="text-[13px] font-medium text-foreground">
              Enable notifications
            </div>
            <div className="text-[11px] text-muted-foreground mt-1 leading-[1.4]">
              Send OS-native notifications for agent events. Notifications are
              suppressed when the app is focused on the relevant terminal.
            </div>
          </div>
        </label>
      </section>

      {/* Per-event toggles */}
      <section>
        <div className={sectionHeadingClass}>Event Types</div>
        <div className="flex flex-col gap-2.5 max-w-[420px]">
          {toggles.map((t) => (
            <label
              key={t.key}
              className={`flex items-start gap-2.5 p-2.5 rounded-[var(--radius-element)] bg-background border border-border cursor-pointer ${!enabled ? "opacity-50 pointer-events-none" : ""}`}
            >
              <Checkbox
                checked={t.value}
                onCheckedChange={(checked) => t.setter(checked === true)}
                disabled={!enabled}
                className="mt-0.5"
              />
              <div>
                <div className="text-[13px] font-medium text-foreground">
                  {t.label}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1 leading-[1.4]">
                  {t.description}
                </div>
              </div>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
