import * as React from 'react';

import {
  Stepper,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from './Stepper';
import { PREVIEW_CSS } from './preview-css';

/** Wraps every export: injects Suna's real compiled CSS + the page substrate
 *  (`bg-background text-foreground`) the components are designed to sit on. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <>
    <style>{PREVIEW_CSS}</style>
    <div className="bg-background text-foreground w-full p-6 font-sans">{children}</div>
  </>
);

const Check = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="size-3">
    <path d="m5 12.5 4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ONBOARDING = [
  {
    step: 1,
    title: 'Connect repo',
    description: 'kortix-ai/suna',
    detail:
      'Suna reads the repo through the GitHub App — no keys to paste. It clones into a sandbox per run, never onto a shared host.',
  },
  {
    step: 2,
    title: 'Configure agent',
    description: 'Tools, model, triggers',
    detail:
      'release-notes-drafter · Opus 5 · 4 tools enabled (shell, read_file, github.create_pr, slack.post_message). Triggers on push to main and daily at 09:00 UTC.',
  },
  {
    step: 3,
    title: 'Deploy',
    description: 'Run in production',
    detail:
      'First run provisions a 2 vCPU sandbox in eu-west-1 and posts its transcript to #suna-runs. You can stop a run mid-turn and the sandbox lease is revoked immediately.',
  },
];

/** The hooks live here rather than in the exported variant: the preview harness
 *  calls each variant as a plain function to read its element, so a variant body
 *  must stay a hook-free JSX factory. */
const OnboardingStepper = () => {
  const [activeStep, setActiveStep] = React.useState(2);
  const active = ONBOARDING.find((s) => s.step === activeStep) ?? ONBOARDING[0];

  return (
      <div className="max-w-2xl space-y-6">
        <div>
          <p className="text-base font-medium">Set up your first agent</p>
          <p className="text-muted-foreground text-sm">
            Step {activeStep} of {ONBOARDING.length} · growtharc workspace
          </p>
        </div>

        <Stepper value={activeStep} onValueChange={setActiveStep} count={ONBOARDING.length}>
          {ONBOARDING.map((item) => (
            <StepperItem key={item.step} step={item.step} className="flex-1 items-start">
              <StepperTrigger className="items-start gap-2.5 text-left">
                <StepperIndicator>
                  {item.step < activeStep ? <Check /> : item.step}
                </StepperIndicator>
                <span className="mt-0.5 block">
                  <StepperTitle>{item.title}</StepperTitle>
                  <StepperDescription className="text-xs">{item.description}</StepperDescription>
                </span>
              </StepperTrigger>
              <StepperSeparator className="mt-3" />
            </StepperItem>
          ))}
        </Stepper>

        <div className="border-border rounded-md border p-4">
          <p className="text-sm font-medium">{active.title}</p>
          <p className="text-muted-foreground mt-1 text-sm">{active.detail}</p>
        </div>
      </div>
  );
};

/** The onboarding flow, middle step active. Clicking a step moves the flow. */
export const OnboardingFlow = () => (
  <Frame>
    <OnboardingStepper />
  </Frame>
);

const DeployRail = () => {
  const [activeStep, setActiveStep] = React.useState(2);

  const steps = [
    { step: 1, title: 'Connect repo', description: 'kortix-ai/suna · GitHub App installed' },
    { step: 2, title: 'Configure agent', description: 'release-notes-drafter · 4 tools' },
    { step: 3, title: 'Deploy', description: 'Provision sandbox in eu-west-1' },
    {
      step: 4,
      title: 'Invite teammates',
      description: 'Needs a Team plan — add billing first',
      disabled: true,
    },
  ];

  return (
      <div className="max-w-md space-y-4">
        <p className="text-muted-foreground text-xs">Deployment checklist</p>
        <Stepper
          value={activeStep}
          onValueChange={setActiveStep}
          orientation="vertical"
          count={steps.length}
        >
          {steps.map((item) => (
            <StepperItem
              key={item.step}
              step={item.step}
              disabled={item.disabled}
              className="items-start"
            >
              <StepperTrigger className="items-start gap-2.5 pb-3 text-left">
                <StepperIndicator>
                  {item.step < activeStep ? <Check /> : item.step}
                </StepperIndicator>
                <span className="mt-0.5 block">
                  <StepperTitle>{item.title}</StepperTitle>
                  <StepperDescription className="text-xs">{item.description}</StepperDescription>
                </span>
              </StepperTrigger>
              <StepperSeparator className="ml-3" />
            </StepperItem>
          ))}
        </Stepper>
      </div>
  );
};

/** `orientation="vertical"` — the same flow as a side rail, plus a `disabled`
 *  step that cannot be reached until billing is set up. */
export const VerticalDeployRail = () => (
  <Frame>
    <DeployRail />
  </Frame>
);
