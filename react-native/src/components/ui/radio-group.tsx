import { cn } from '@/lib/utils';
import * as RadioGroupPrimitive from '@rn-primitives/radio-group';
import { Platform } from 'react-native';
import { withUniwind } from 'uniwind';

const PrimitiveIndicator = withUniwind(RadioGroupPrimitive.Indicator);
const PrimitiveItem = withUniwind(RadioGroupPrimitive.Item);
const PrimitiveRoot = withUniwind(RadioGroupPrimitive.Root);

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <PrimitiveRoot className={cn('gap-3', className)} {...props} />;
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <PrimitiveItem
      className={cn(
        'border-input dark:bg-input/30 aspect-square size-4 shrink-0 items-center justify-center rounded-full border shadow-sm shadow-black/5',
        Platform.select({
          web: 'focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive outline-none transition-all focus-visible:ring-[3px] disabled:cursor-not-allowed',
        }),
        props.disabled && 'opacity-50',
        className
      )}
      {...props}>
      <PrimitiveIndicator className="bg-primary size-2 rounded-full" />
    </PrimitiveItem>
  );
}

export { RadioGroup, RadioGroupItem };
