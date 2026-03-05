import { AlertTriangle, X } from "lucide-react";

import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/orecus.io/components/enhanced-button";

interface ConfirmDialogProps {
  title: string;
  message: string;
  variant: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}

export default function ConfirmDialog({
  title,
  message,
  variant,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const accentColor = useProjectAccentColor();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="min-w-[360px] max-w-[440px]"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {variant === "danger" && (
              <AlertTriangle className="size-4 text-destructive" />
            )}
            {title}
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs leading-relaxed text-dim-foreground">{message}</p>

        {children}

        <DialogFooter>
          <DialogClose
            render={
              <Button
                variant="outline"
                size="sm"
                leftIcon={<X className="size-3.5" />}
                hoverEffect="scale"
                clickEffect="scale"
              />
            }
          >
            Cancel
          </DialogClose>
          <Button
            variant="color"
            color={variant === "danger" ? "red" : accentColor}
            size="sm"
            onClick={onConfirm}
            hoverEffect="scale-glow"
            clickEffect="scale"
          >
            {variant === "danger" ? "Delete" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
