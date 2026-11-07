// V2-ADMIN-TIME-10 — modal for create/edit own timesheet draft.
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { isTimesheetError, type TimesheetEntry } from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { TextField } from '../../ui/TextField';
import { AdminFormActions } from '../AdminFormActions';
import { container } from '../../../lib/container';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { formDecimalInputProps, formIsoDateInputProps } from '../../../lib/platform/formTextInputHints';

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
  const today = new Date().toISOString().slice(0, 10);
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
    <View style={styles.backdrop} pointerEvents="box-none">
      <ScrollView style={styles.sheet} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{isEdit ? t.form.editTitle : t.form.createTitle}</Text>

        <TextField label={t.form.workDateLabel} value={workDate} onChangeText={setWorkDate} {...formIsoDateInputProps} />
        <TextField label={t.form.hoursLabel} value={hoursText} onChangeText={setHoursText} {...formDecimalInputProps} />
        <TextField label={t.form.projectLabel}     value={project}     onChangeText={setProject} />
        <TextField label={t.form.descriptionLabel} value={description} onChangeText={setDescription} multiline />

        <AdminFormActions
          cancelLabel={t.form.cancel}
          submitLabel={t.form.submit}
          submittingLabel={t.form.submit}
          isPending={save.isPending}
          onCancel={onClose}
          onSubmit={() => { void save.mutateAsync(); }}
          errorMsg={errorMsg}
        />
      </ScrollView>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  backdrop: {
    position: 'absolute', top: 0, start: 0, end: 0, bottom: 0,
    backgroundColor: colors.overlay, justifyContent: 'flex-end',
  },
  sheet:   { maxHeight: '90%', backgroundColor: colors.surface,
             borderTopStartRadius: radius.lg, borderTopEndRadius: radius.lg },
  content: { padding: spacing.base, gap: spacing.md },
  title:   { ...typography.h3, ...typography.bold, color: colors.textPrimary },
}));
