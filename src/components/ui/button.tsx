import type { ComponentProps } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';
const variants = cva('button', { variants: { variant: { primary: 'button-primary', dark: 'button-dark', outline: 'button-outline', ghost: 'button-ghost' }, size: { default: '', small: 'button-small' } }, defaultVariants: { variant: 'primary', size: 'default' } });
export function Button({ className, variant, size, asChild = false, ...props }: ComponentProps<'button'> & VariantProps<typeof variants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(variants({ variant, size }), className)} {...props} />;
}
