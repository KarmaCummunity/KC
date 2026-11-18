// V2-ADMIN-TIME-10 — bottom sheet to create / edit one's own timesheet draft, on the kit sheet (its
// own form scope); the work day is picked in local time.
import { useState } from 'react';
import { View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { isTimesheetError, type TimesheetEntry } from '@kc/domain';
import { makeUseStyles, spacing } from '@kc/ui';
import { TextField } from '../../ui/TextField';
import { AdminFormActions } from '../AdminFormActions';
import { container } from '../../../lib/container';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { BottomSheet } from '../../ui/BottomSheet';
import { AdminDateField } from '../AdminDateField';
import { dateToLocalDay } from '../../../lib/localDay';

export interface TimesheetFormModalProps {
  readonly initial: TimesheetEntry | null;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

export function TimesheetFormModal({ initial, onClose, onSaved }: TimesheetFormModalProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const t = L.admin.time;
  const isEdit = initial !== null;
  // Today in local time: a UTC date would be yesterday shortly after midnight in Israel.
  const today = dateToLocalDay(new Date());
  const [workDate,    setWorkDate]    = useState(initial?.workDate ?? today);
  const [hoursText,   setHoursText]   = useState(initial ? (initial.hoursX100 / 100).toString() : '');
  const [project,     setProject]     = useState(initial?.project ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [errorMsg,    setErrorMsg]    = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const hours = Number.parseFloat(hoursText);
      if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
        throw new Error('invalid_hours');
      }
      const hoursX100 = Math.round(hours * 100);
      return container.upsertTimesheet.execute({
        entryId: initial?.entryId ?? null,
        workDate,
        hoursX100,
        project:     project.trim() || null,
        description: description.trim() || null,
      });
    },
    onSuccess: () => onSaved(),
    onError:   (err) => {
      const code = isTimesheetError(err) ? err.code : 'unknown';
      setErrorMsg(t.errors[code as keyof typeof t.errors] ?? t.errors.unknown);
    },
  });

  return (
    <BottomSheet
      visible
      onDismiss={onClose}
      dismissible={!save.isPending}
      title={isEdit ? t.form.editTitle : t.form.createTitle}
      testID="timesheet-form"
      footer={
        <AdminFormActions
          cancelLabel={t.form.cancel}
          submitLabel={t.form.submit}
          submittingLabel={t.form.submit}
          isPending={save.isPending}
          onCancel={onClose}
          onSubmit={() => { void save.mutateAsync(); }}
          errorMsg={errorMsg}
        />
      }
    >
      <View style={styles.content}>
        <AdminDateField label={t.form.workDateLabel} value={workDate} onChange={setWorkDate} />
        <TextField label={t.form.hoursLabel} value={hoursText} onChangeText={setHoursText} inputKind="decimal" required />
        <TextField label={t.form.projectLabel} value={project} onChangeText={setProject} />
        <TextField label={t.form.descriptionLabel} value={description} onChangeText={setDescription} multiline />
      </View>
    </BottomSheet>
  );
}

const useStyles = makeUseStyles(() => ({
  content: { gap: spacing.md },
}));
