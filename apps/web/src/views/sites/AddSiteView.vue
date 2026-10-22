<script setup lang="ts">
import {
  CHECK_INTERVAL_LABELS,
  CHECK_INTERVAL_MINUTES,
  VERIFICATION_FILE_PATH,
  VERIFICATION_METHOD_LABELS,
  VERIFICATION_TXT_PREFIX,
  checkIntervalSchema,
  domainSchema,
  verificationAttemptSchema,
  type CheckIntervalMinutes,
  type Site,
  type VerificationAttempt,
  type VerificationMethod,
} from '@sitesentinel/shared';
import { useField, useForm } from 'vee-validate';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { z } from 'zod';
import { ApiError } from '../../api/client';
import { userMessage } from '../../api/errors';
import { sitesApi } from '../../api/sites';
import CopyField from '../../components/CopyField.vue';
import { toTypedSchema } from '../../forms/zod-schema';
import { useSitesStore } from '../../stores/sites';

/** Set when resuming verification of a site added earlier (/sites/:id/setup). */
const props = defineProps<{ id?: string }>();

const sites = useSitesStore();
const router = useRouter();

type Step = 'domain' | 'method' | 'verify' | 'done';
const STEPS: { value: Step; title: string }[] = [
  { value: 'domain', title: 'Domain' },
  { value: 'method', title: 'Verification method' },
  { value: 'verify', title: 'Verify' },
];
const step = ref<Step>(props.id ? 'method' : 'domain');
const stepIndex = computed(() => STEPS.findIndex((s) => s.value === step.value) + 1);
const site = ref<Site | null>(null);
const loadError = ref<string | null>(null);

// --- Step 1: domain ---------------------------------------------------------------
const siteFormSchema = z.object({
  domain: domainSchema,
  displayName: z.string().trim().max(100),
  checkIntervalMinutes: checkIntervalSchema,
});

const { handleSubmit, isSubmitting, resetForm } = useForm({
  validationSchema: toTypedSchema(siteFormSchema),
  initialValues: { domain: '', displayName: '', checkIntervalMinutes: 60 as CheckIntervalMinutes },
});
const { value: domain, errorMessage: domainError } = useField<string>('domain');
const { value: displayName, errorMessage: displayNameError } = useField<string>('displayName');
const { value: interval } = useField<CheckIntervalMinutes>('checkIntervalMinutes');
const intervalItems = CHECK_INTERVAL_MINUTES.map((m) => ({
  title: CHECK_INTERVAL_LABELS[m],
  value: m,
}));
const createError = ref<string | null>(null);

const onCreate = handleSubmit(async (values) => {
  createError.value = null;
  try {
    site.value = await sites.create({
      domain: values.domain,
      checkIntervalMinutes: values.checkIntervalMinutes,
      ...(values.displayName && { displayName: values.displayName }),
    });
    step.value = 'method';
  } catch (err) {
    createError.value = userMessage(err);
  }
});

// --- Step 2: method ---------------------------------------------------------------
const method = ref<VerificationMethod>('DNS_TXT');
const methods: { value: VerificationMethod; text: string }[] = [
  {
    value: 'DNS_TXT',
    text: 'Add a TXT record at your DNS provider. Best if you manage DNS; can take a few minutes to propagate.',
  },
  {
    value: 'WELL_KNOWN_FILE',
    text: 'Upload a small text file to your website. Best if you can deploy files but not edit DNS.',
  },
];

// --- Step 3: verify ---------------------------------------------------------------
const txtValue = computed(
  () => `${VERIFICATION_TXT_PREFIX}${site.value?.verification.token ?? ''}`,
);
const fileUrl = computed(() => `https://${site.value?.domain ?? ''}${VERIFICATION_FILE_PATH}`);
const verifying = ref(false);
const verifyError = ref<string | null>(null);
const attempts = ref<VerificationAttempt[]>([]);

async function verify() {
  if (!site.value) return;
  verifying.value = true;
  verifyError.value = null;
  attempts.value = [];
  try {
    site.value = await sites.verify(site.value.id, method.value);
    step.value = 'done';
  } catch (err) {
    verifyError.value = userMessage(err);
    if (err instanceof ApiError) {
      const parsed = z.array(verificationAttemptSchema).safeParse(err.extensions.attempts);
      if (parsed.success) attempts.value = parsed.data;
    }
  } finally {
    verifying.value = false;
  }
}

/** Back to step one with an empty form (a new site, even when resuming one). */
async function startOver() {
  if (props.id) await router.push({ name: 'site-new' });
  site.value = null;
  method.value = 'DNS_TXT';
  verifyError.value = null;
  attempts.value = [];
  resetForm();
  step.value = 'domain';
}

onMounted(async () => {
  if (!props.id) return;
  try {
    site.value = await sitesApi.get(props.id);
    if (site.value.verification.verifiedAt) step.value = 'done';
  } catch (err) {
    loadError.value = userMessage(err);
  }
});
</script>

<template>
  <v-container class="py-8" max-width="760">
    <v-btn
      :to="site ? { name: 'site', params: { id: site.id } } : { name: 'sites' }"
      variant="text"
      prepend-icon="mdi-arrow-left"
      class="mb-4"
    >
      {{ site ? 'Back to site' : 'Back to sites' }}
    </v-btn>
    <h1 class="text-h4 mb-2">{{ id ? 'Verify ownership' : 'Add a site' }}</h1>
    <p class="text-body-1 text-medium-emphasis mb-6">
      SiteSentinel only checks domains you prove you own. Checks are passive: the same HTTPS
      requests, TLS handshakes and DNS lookups a browser or mail server makes.
    </p>

    <v-alert v-if="loadError" type="error" variant="tonal" role="alert">{{ loadError }}</v-alert>

    <v-card v-else-if="step === 'done' && site" border flat data-test="done">
      <v-empty-state
        icon="mdi-shield-check-outline"
        color="success"
        :title="`${site.domain} is verified`"
        text="The first checks run within a few minutes; the grade appears on the site's page as results arrive."
      >
        <template #actions>
          <v-btn :to="{ name: 'site', params: { id: site.id } }" color="primary" variant="flat">
            View site
          </v-btn>
          <v-btn data-test="add-another" @click="startOver">Add another</v-btn>
        </template>
      </v-empty-state>
    </v-card>

    <template v-else>
      <ol class="steps mb-6" aria-label="Progress">
        <li
          v-for="(s, i) in STEPS"
          :key="s.value"
          :aria-current="s.value === step ? 'step' : undefined"
          :class="{ active: s.value === step, complete: i + 1 < stepIndex }"
        >
          <v-icon
            :icon="i + 1 < stepIndex ? 'mdi-check-circle' : `mdi-numeric-${i + 1}-circle`"
            aria-hidden="true"
            size="small"
          />
          {{ s.title }}
        </li>
      </ol>

      <!-- Step 1 -->
      <v-card v-if="step === 'domain'" border flat data-test="step-domain">
        <form novalidate @submit.prevent="onCreate">
          <v-card-text>
            <v-alert v-if="createError" type="error" variant="tonal" class="mb-4" role="alert">
              {{ createError }}
            </v-alert>
            <v-text-field
              v-model="domain"
              label="Domain"
              placeholder="example.com"
              hint="Just the domain, without a path; a leading https:// is removed for you."
              persistent-hint
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              :error-messages="domainError"
              class="mb-3"
              autofocus
              data-test="domain"
            />
            <v-text-field
              v-model="displayName"
              label="Display name (optional)"
              hint="Defaults to the domain."
              persistent-hint
              :error-messages="displayNameError"
              class="mb-3"
            />
            <v-select v-model="interval" :items="intervalItems" label="Check every" />
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn
              type="submit"
              color="primary"
              variant="flat"
              :loading="isSubmitting"
              data-test="create"
            >
              Continue
            </v-btn>
          </v-card-actions>
        </form>
      </v-card>

      <!-- Step 2 -->
      <v-card v-else-if="step === 'method'" border flat data-test="step-method">
        <v-card-text>
          <p class="text-body-1 mb-4">
            How do you want to prove you own <strong>{{ site?.domain ?? '…' }}</strong
            >?
          </p>
          <v-radio-group v-model="method" aria-label="Verification method">
            <v-radio v-for="m in methods" :key="m.value" :value="m.value" class="mb-2">
              <template #label>
                <div>
                  <div class="font-weight-medium">{{ VERIFICATION_METHOD_LABELS[m.value] }}</div>
                  <div class="text-body-2 text-medium-emphasis">{{ m.text }}</div>
                </div>
              </template>
            </v-radio>
          </v-radio-group>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            color="primary"
            variant="flat"
            :disabled="!site"
            data-test="choose-method"
            @click="step = 'verify'"
          >
            Continue
          </v-btn>
        </v-card-actions>
      </v-card>

      <!-- Step 3 -->
      <v-card v-else-if="step === 'verify' && site" border flat data-test="step-verify">
        <v-card-text>
          <template v-if="method === 'DNS_TXT'">
            <p class="text-body-1 mb-4">
              At your DNS provider, add this <strong>TXT</strong> record to
              <strong>{{ site.domain }}</strong> (the host is often written as <code>@</code>):
            </p>
            <CopyField label="TXT record value" :value="txtValue" />
            <p class="text-body-2 text-medium-emphasis mt-2">
              DNS changes can take a few minutes to appear. You can leave this page and finish later
              from the site's page.
            </p>
          </template>
          <template v-else>
            <p class="text-body-1 mb-4">
              Publish a plain-text file at this address, containing only the token:
            </p>
            <CopyField label="File URL" :value="fileUrl" />
            <CopyField label="File contents" :value="site.verification.token" class="mt-2" />
          </template>

          <v-alert
            v-if="verifyError"
            type="error"
            variant="tonal"
            class="mt-4"
            role="alert"
            data-test="verify-error"
          >
            <p>{{ verifyError }}</p>
            <ul v-if="attempts.length" class="mt-2 pl-4" data-test="attempts">
              <li v-for="a in attempts" :key="a.method">
                {{ VERIFICATION_METHOD_LABELS[a.method] }}: {{ a.detail }}
              </li>
            </ul>
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-btn @click="step = 'method'">Change method</v-btn>
          <v-spacer />
          <v-btn
            color="primary"
            variant="flat"
            :loading="verifying"
            data-test="verify"
            @click="verify"
          >
            Verify
          </v-btn>
        </v-card-actions>
      </v-card>
    </template>
  </v-container>
</template>

<style scoped>
.steps {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  list-style: none;
  padding: 0;
  color: rgba(var(--v-theme-on-background), var(--v-medium-emphasis-opacity));
}

.steps .active {
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}

.steps .complete {
  color: rgb(var(--v-theme-success));
}
</style>
