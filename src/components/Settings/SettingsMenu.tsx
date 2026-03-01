import {
  Bell,
  Bot,
  FolderOpen,
  Settings,
  SlidersHorizontal,
  TerminalSquare,
} from "lucide-react";
import { useState } from "react";

import { useAppStore } from "../../store/appStore";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { AgentsTab } from "./AgentsTab";
import { GeneralTab } from "./GeneralTab";
import { NotificationsTab } from "./NotificationsTab";
import { ProjectsTab } from "./ProjectsTab";
import { TerminalTab } from "./TerminalTab";

type SettingsDialog =
  | "general"
  | "terminal"
  | "notifications"
  | "agents"
  | "projects"
  | null;

const MENU_ITEMS: {
  id: SettingsDialog & string;
  label: string;
  icon: typeof Settings;
}[] = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "terminal", label: "Terminal", icon: TerminalSquare },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "projects", label: "Projects", icon: FolderOpen },
];

const DIALOG_CONFIG: Record<string, { title: string; maxWidth: string }> = {
  general: { title: "General Settings", maxWidth: "sm:max-w-lg" },
  terminal: { title: "Terminal Settings", maxWidth: "sm:max-w-md" },
  notifications: { title: "Notifications", maxWidth: "sm:max-w-md" },
  agents: { title: "Agent Configuration", maxWidth: "sm:max-w-2xl" },
  projects: { title: "Project Settings", maxWidth: "sm:max-w-2xl" },
};

export default function SettingsMenu() {
  const [openDialog, setOpenDialog] = useState<SettingsDialog>(null);
  const agents = useAppStore((s) => s.agents);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              hoverEffect="none"
              clickEffect="none"
              title="Settings"
            />
          }
        >
          <Settings size={16} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="start" sideOffset={4}>
          {MENU_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <DropdownMenuItem
                key={item.id}
                onClick={() => setOpenDialog(item.id)}
              >
                <Icon className="size-4" />
                {item.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Dialogs */}
      {openDialog && (
        <Dialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setOpenDialog(null);
          }}
        >
          <DialogContent className={DIALOG_CONFIG[openDialog].maxWidth}>
            <DialogHeader>
              <DialogTitle>{DIALOG_CONFIG[openDialog].title}</DialogTitle>
            </DialogHeader>
            <div className="max-h-[70vh] overflow-y-auto -mx-6 px-6">
              {openDialog === "general" && <GeneralTab />}
              {openDialog === "terminal" && <TerminalTab />}
              {openDialog === "notifications" && <NotificationsTab />}
              {openDialog === "agents" && <AgentsTab agents={agents} />}
              {openDialog === "projects" && <ProjectsTab agents={agents} onClose={() => setOpenDialog(null)} />}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
