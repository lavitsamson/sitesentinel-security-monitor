<script setup lang="ts">
import { PASSWORD_MIN_LENGTH, registerSchema } from '@sitesentinel/shared';
import { useField, useForm } from 'vee-validate';
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { userMessage } from '../../api/errors';
import AuthCard from '../../components/auth/AuthCard.vue';
import PasswordField from '../../components/auth/PasswordField.vue';
import { toTypedSchema } from '../../forms/zod-schema';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const router = useRouter();

const { handleSubmit, isSubmitting } = useForm({
  validationSchema: toTypedSchema(registerSchema),
  initialValues: { name: '', email: '', password: '' },
});
const { value: name, errorMessage: nameError } = useField<string>('name');
const { value: email, errorMessage: emailError } = useField<string>('email');
const { value: password, errorMessage: passwordError } = useField<string>('password');

const error = ref<string | null>(null);

const onSubmit = handleSubmit(async (values) => {
  error.value = null;
  try {
    await auth.register(values);
    await router.push({ name: 'dashboard' });
  } catch (err) {
    error.value = userMessage(err);
  }
});
</script>

<template>
  <AuthCard title="Create your account" subtitle="Free, and only for domains you own.">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" role="alert" data-test="error">
      {{ error }}
    </v-alert>

    <form novalidate @submit.prevent="onSubmit">
      <v-text-field
        v-model="name"
        label="Name"
        autocomplete="name"
        prepend-inner-icon="mdi-account-outline"
        :error-messages="nameError"
        class="mb-2"
        autofocus
      />
      <v-text-field
        v-model="email"
        label="Email"
        type="email"
        autocomplete="email"
        prepend-inner-icon="mdi-email-outline"
        :error-messages="emailError"
        class="mb-2"
      />
      <PasswordField
        v-model="password"
        label="Password"
        autocomplete="new-password"
        :hint="`At least ${PASSWORD_MIN_LENGTH} characters. A short phrase works well.`"
        :error-messages="passwordError"
        class="mb-4"
      />
      <v-btn type="submit" color="primary" size="large" block :loading="isSubmitting">
        Create account
      </v-btn>
    </form>

    <template #footer>
      <span class="text-medium-emphasis mr-1">Already have an account?</span>
      <router-link :to="{ name: 'login' }">Sign in</router-link>
    </template>
  </AuthCard>
</template>
