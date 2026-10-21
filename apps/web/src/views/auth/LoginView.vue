<script setup lang="ts">
import { loginSchema } from '@sitesentinel/shared';
import { useField, useForm } from 'vee-validate';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { userMessage } from '../../api/errors';
import AuthCard from '../../components/auth/AuthCard.vue';
import PasswordField from '../../components/auth/PasswordField.vue';
import { toTypedSchema } from '../../forms/zod-schema';
import { safeRedirect } from '../../router/guards';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const { handleSubmit, isSubmitting } = useForm({
  validationSchema: toTypedSchema(loginSchema),
  initialValues: { email: '', password: '' },
});
const { value: email, errorMessage: emailError } = useField<string>('email');
const { value: password, errorMessage: passwordError } = useField<string>('password');

const error = ref<string | null>(null);
const notice = computed(() => {
  if (route.query.reset === '1') return 'Your password has been changed. Sign in with the new one.';
  if (route.query.expired === '1') return 'Your session has expired. Please sign in again.';
  return null;
});

const onSubmit = handleSubmit(async (values) => {
  error.value = null;
  try {
    await auth.login(values);
    await router.push(safeRedirect(route.query.redirect));
  } catch (err) {
    error.value = userMessage(err);
  }
});
</script>

<template>
  <AuthCard title="Sign in" subtitle="Monitor the security of websites you own.">
    <v-alert v-if="notice" type="info" variant="tonal" class="mb-4" data-test="notice">
      {{ notice }}
    </v-alert>
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" role="alert" data-test="error">
      {{ error }}
    </v-alert>

    <form novalidate @submit.prevent="onSubmit">
      <v-text-field
        v-model="email"
        label="Email"
        type="email"
        autocomplete="email"
        prepend-inner-icon="mdi-email-outline"
        :error-messages="emailError"
        class="mb-2"
        autofocus
      />
      <PasswordField
        v-model="password"
        label="Password"
        autocomplete="current-password"
        :error-messages="passwordError"
      />
      <div class="d-flex justify-end mb-4">
        <router-link :to="{ name: 'forgot-password' }" class="text-body-2">
          Forgot password?
        </router-link>
      </div>
      <v-btn type="submit" color="primary" size="large" block :loading="isSubmitting">
        Sign in
      </v-btn>
    </form>

    <template #footer>
      <span class="text-medium-emphasis mr-1">New to SiteSentinel?</span>
      <router-link :to="{ name: 'register' }">Create an account</router-link>
    </template>
  </AuthCard>
</template>
