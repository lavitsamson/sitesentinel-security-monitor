<script setup lang="ts">
import { forgotPasswordSchema } from '@sitesentinel/shared';
import { useField, useForm } from 'vee-validate';
import { ref } from 'vue';
import { userMessage } from '../../api/errors';
import AuthCard from '../../components/auth/AuthCard.vue';
import { toTypedSchema } from '../../forms/zod-schema';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();

const { handleSubmit, isSubmitting } = useForm({
  validationSchema: toTypedSchema(forgotPasswordSchema),
  initialValues: { email: '' },
});
const { value: email, errorMessage: emailError } = useField<string>('email');

const sent = ref(false);
const error = ref<string | null>(null);

const onSubmit = handleSubmit(async (values) => {
  error.value = null;
  try {
    await auth.forgotPassword(values);
    sent.value = true;
  } catch (err) {
    error.value = userMessage(err);
  }
});
</script>

<template>
  <AuthCard title="Forgot your password?" subtitle="We'll email you a link to choose a new one.">
    <!-- The same message whether or not the account exists (no account enumeration). -->
    <v-alert v-if="sent" type="success" variant="tonal" role="status" data-test="sent">
      If an account exists for that email, a reset link is on its way. It expires in an hour.
    </v-alert>

    <template v-else>
      <v-alert v-if="error" type="error" variant="tonal" class="mb-4" role="alert">
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
          class="mb-4"
          autofocus
        />
        <v-btn type="submit" color="primary" size="large" block :loading="isSubmitting">
          Send reset link
        </v-btn>
      </form>
    </template>

    <template #footer>
      <router-link :to="{ name: 'login' }">Back to sign in</router-link>
    </template>
  </AuthCard>
</template>
