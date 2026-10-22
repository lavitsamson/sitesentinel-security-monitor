<script setup lang="ts">
import {
  PASSWORD_MIN_LENGTH,
  changePasswordSchema,
  updateProfileSchema,
} from '@sitesentinel/shared';
import { useField, useForm } from 'vee-validate';
import { ref, watch } from 'vue';
import { z } from 'zod';
import { ApiError } from '../api/client';
import { userMessage } from '../api/errors';
import PasswordField from '../components/auth/PasswordField.vue';
import { toTypedSchema } from '../forms/zod-schema';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();

const snackbar = ref({ show: false, text: '', color: 'success' });
const notify = (text: string, color = 'success') => (snackbar.value = { show: true, text, color });

// --- Profile ------------------------------------------------------------------
const name = ref(auth.user?.name ?? '');
const nameError = ref<string | undefined>();
const savingName = ref(false);
watch(
  () => auth.user?.name,
  (current) => {
    if (current !== undefined) name.value = current;
  },
);

async function saveName() {
  const parsed = updateProfileSchema.safeParse({ name: name.value });
  nameError.value = parsed.success ? undefined : parsed.error.issues[0]?.message;
  if (!parsed.success) return;
  savingName.value = true;
  try {
    await auth.updateProfile(parsed.data);
    notify('Name saved.');
  } catch (err) {
    notify(userMessage(err), 'error');
  } finally {
    savingName.value = false;
  }
}

// --- Notifications ------------------------------------------------------------
const savingPrefs = ref(false);

async function setEmailAlerts(emailAlerts: boolean) {
  savingPrefs.value = true;
  try {
    await auth.updateProfile({ notificationPrefs: { emailAlerts } });
    notify(emailAlerts ? 'Email alerts turned on.' : 'Email alerts turned off.');
  } catch (err) {
    notify(userMessage(err), 'error');
  } finally {
    savingPrefs.value = false;
  }
}

// --- Password -----------------------------------------------------------------
const passwordFormSchema = changePasswordSchema
  .extend({ confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, {
    path: ['confirm'],
    message: "The passwords don't match",
  });

const { handleSubmit, isSubmitting, resetForm, setFieldError } = useForm({
  validationSchema: toTypedSchema(passwordFormSchema),
  initialValues: { currentPassword: '', newPassword: '', confirm: '' },
});
const { value: currentPassword, errorMessage: currentError } = useField<string>('currentPassword');
const { value: newPassword, errorMessage: newError } = useField<string>('newPassword');
const { value: confirm, errorMessage: confirmError } = useField<string>('confirm');

const changePassword = handleSubmit(async (values) => {
  try {
    await auth.changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
    });
    resetForm();
    notify('Password changed. Other devices have been signed out.');
  } catch (err) {
    const wrongCurrent =
      err instanceof ApiError && err.problem?.errors?.some((e) => e.path === 'currentPassword');
    if (wrongCurrent) setFieldError('currentPassword', 'Your current password is incorrect');
    else notify(userMessage(err), 'error');
  }
});
</script>

<template>
  <v-container class="py-8" max-width="720">
    <h1 class="text-h4 mb-6">Settings</h1>

    <v-card border flat class="mb-6">
      <v-card-item title="Profile" :subtitle="auth.user?.email" />
      <v-card-text>
        <form novalidate class="d-flex flex-wrap ga-4 align-start" @submit.prevent="saveName">
          <v-text-field
            v-model="name"
            label="Name"
            autocomplete="name"
            :error-messages="nameError"
            class="flex-grow-1"
            style="min-width: 220px"
            data-test="profile-name"
          />
          <v-btn type="submit" :loading="savingName" class="mt-2" data-test="profile-save">
            Save
          </v-btn>
        </form>
      </v-card-text>
    </v-card>

    <v-card border flat class="mb-6">
      <v-card-item title="Notifications" />
      <v-card-text>
        <v-switch
          :model-value="auth.user?.notificationPrefs.emailAlerts ?? true"
          :loading="savingPrefs"
          :disabled="savingPrefs"
          color="primary"
          inset
          label="Email alerts"
          hint="Off mutes every email channel. Webhooks are still sent."
          persistent-hint
          data-test="email-alerts"
          @update:model-value="setEmailAlerts(Boolean($event))"
        />
        <p class="text-body-2 mt-4">
          Choose where alerts go on the
          <router-link :to="{ name: 'alert-channels' }">alert channels</router-link> page.
        </p>
      </v-card-text>
    </v-card>

    <v-card border flat>
      <v-card-item
        title="Change password"
        subtitle="Other devices are signed out; this one stays signed in."
      />
      <v-card-text>
        <form novalidate data-test="password-form" @submit.prevent="changePassword">
          <!-- Lets password managers pair the new password with the account. -->
          <input
            type="text"
            name="username"
            autocomplete="username"
            :value="auth.user?.email"
            hidden
          />
          <PasswordField
            v-model="currentPassword"
            label="Current password"
            autocomplete="current-password"
            :error-messages="currentError"
            class="mb-2"
            data-test="current-password"
          />
          <PasswordField
            v-model="newPassword"
            label="New password"
            autocomplete="new-password"
            :hint="`At least ${PASSWORD_MIN_LENGTH} characters.`"
            :error-messages="newError"
            class="mb-2"
            data-test="new-password"
          />
          <PasswordField
            v-model="confirm"
            label="Confirm new password"
            autocomplete="new-password"
            :error-messages="confirmError"
            class="mb-4"
            data-test="confirm-password"
          />
          <v-btn
            type="submit"
            color="primary"
            variant="flat"
            :loading="isSubmitting"
            data-test="password-save"
          >
            Change password
          </v-btn>
        </form>
      </v-card-text>
    </v-card>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="6000">
      {{ snackbar.text }}
    </v-snackbar>
  </v-container>
</template>
