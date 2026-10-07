import { z } from 'zod';

import { emailSchema, passwordSchema } from '@/validation/common';

export const signInSchema = z.object({
  email: emailSchema,
  // Do not apply the length policy on sign-in: legacy passwords must still work.
  password: z.string().min(1, { message: 'validation.required' }),
});
export type SignInValues = z.infer<typeof signInSchema>;

export const signUpSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'auth.passwordsDontMatch',
  });
export type SignUpValues = z.infer<typeof signUpSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export const newPasswordSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'auth.passwordsDontMatch',
  });
export type NewPasswordValues = z.infer<typeof newPasswordSchema>;
