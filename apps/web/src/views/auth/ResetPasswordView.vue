<script setup lang="ts">
import { PASSWORD_MIN_LENGTH, passwordSchema } from '@sitesentinel/shared';
import { useField, useForm } from 'vee-validate';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { z } from 'zod';
import { userMessage } from '../../api/errors';
import AuthCard from '../../components/auth/AuthCard.vue';
import PasswordField from '../../components/auth/PasswordField.vue';
import { toTypedSchema } from '../../forms/zod-schema';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''));

const formSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: "The passwords don't match",
  });

const { handleSubmit, isSubmitting } = useForm({
  validationSchema: toTypedSchema(formSchema),
  initialValues: { password: '', confirm: '' },
});
const { value: password, errorMessage: passwordError } = useField<string>('password');
const { value: confirm, errorMessage: confirmError } = useField<string>('confirm');

const error = ref<string | null>(null);

const onSubmit = handleSubmit(async ({ password: newPassword }) => {
  error.value = null;
  try {
    await auth.resetPassword({ token: token.value, password: newPassword });
    // Every session was ended by the reset, including any in this browser.
    auth.clearSession();
    await router.push({ name: 'login', query: { reset: '1' } });
  } catch (err) {
    error.value = userMessage(err);
  }
});
</script>

<template>
  <AuthCard title="Choose a new password">
    <v-alert v-if="!token" type="error" variant="tonal" role="alert" data-test="missing-token">
      This reset link is incomplete. Request a new one below.
    </v-alert>

    <template v-else>
      <v-alert
        v-if="error"
        type="error"
        variant="tonal"
        class="mb-4"
        role="alert"
        data-test="error"
      >
        {{ error }}
        <router-link :to="{ name: 'forgot-password' }" class="d-block mt-1">
          Request a new link
        </router-link>
      </v-alert>
      <form novalidate @submit.prevent="onSubmit">
        <PasswordField
          v-model="password"
          label="New password"
          autocomplete="new-password"
          :hint="`At least ${PASSWORD_MIN_LENGTH} characters.`"
          :error-messages="passwordError"
          class="mb-2"
        />
        <PasswordField
          v-model="confirm"
          label="Confirm new password"
          autocomplete="new-password"
          :error-messages="confirmError"
          class="mb-4"
        />
        <p class="text-body-2 text-medium-emphasis mb-4">
          You'll be signed out everywhere and can then sign in with the new password.
        </p>
        <v-btn type="submit" color="primary" size="large" block :loading="isSubmitting">
          Change password
        </v-btn>
      </form>
    </template>

    <template #footer>
      <router-link :to="{ name: 'forgot-password' }">Request a new link</router-link>
    </template>
  </AuthCard>
</template>
