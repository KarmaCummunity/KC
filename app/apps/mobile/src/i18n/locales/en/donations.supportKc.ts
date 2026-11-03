// English — direct support for KC: one-time + monthly standing order (FR-DONATE-011, D20).
// The disclosure lines are the donor-facing legal notice; change them only with PM approval.
export const supportKc = {
  title: 'Support Karma Community directly',
  tagline: 'Karma is free for everyone. Your donation funds building and running the platform.',
  oneTimeHeading: 'One-time donation',
  standingOrderHeading: 'Monthly standing order',
  standingOrderBody: 'A fixed monthly credit-card donation, in an amount you choose, on the secure {{provider}} payment page.',
  channel: {
    bit: 'Transfer via Bit',
    paybox: 'Transfer via PayBox',
    card_one_time: 'Credit card',
    card_standing_order: 'Set up a standing order',
  },
  channelA11y: '{{label}} — opens outside the app, on the {{provider}} payment page',
  loading: 'Loading donation options…',
  unavailable: 'Direct donation options are unavailable right now. Please try again later.',
  linkError: 'We couldn’t open the payment page. Try again or open it in a browser.',
  disclosureTitle: 'Before you donate',
  disclosureSecure:
    'Payment happens outside the app, with a licensed payment provider. Your card and account details never pass through us and are never stored by us.',
  disclosureRecipient: 'The money goes to Karma Community and is used only to build and run the platform.',
  disclosureTax:
    'Karma Community is not yet a registered nonprofit, so this donation is not eligible for a section 46 tax credit. The payment provider will send you a payment confirmation.',
  disclosureVoluntary: 'Donating is voluntary and does not grant any benefit, service or priority in the app.',
  disclosureCancel: 'You can cancel the standing order at any time. Cancellation takes effect within 3 business days at the latest.',
  cancelCta: 'Request to cancel a standing order',
  cancelConfirmTitle: 'Cancel standing order',
  cancelConfirmBody: 'We will send a cancellation request to the Karma team in the support chat and confirm the cancellation there.',
  cancelConfirm: 'Send request',
  cancelMessage: 'Request to cancel my standing order supporting Karma Community.',
  cancelError: 'We couldn’t send the request. Please try again.',
  partnersTitle: 'Donate to nonprofits',
  partnersBody: 'Want to donate to a nonprofit? jgive lists a wide range of registered nonprofits for secure donations.',
} as const;
