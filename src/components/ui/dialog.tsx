// Adapted from shadcn/ui Dialog (MIT), with YOUKEY styles and focus restoration.
import type { ComponentProps } from 'react';
import * as Primitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
export const Dialog = Primitive.Root;
export const DialogTitle = Primitive.Title;
export const DialogDescription = Primitive.Description;
export function DialogContent({ children, className, ...props }: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal><Primitive.Overlay className="dialog-overlay" /><Primitive.Content className={cn('dialog-content', className)} {...props}>{children}<Primitive.Close className="icon-button dialog-close" aria-label="Закрыть окно"><X size={22} /></Primitive.Close></Primitive.Content></Primitive.Portal>;
}
