-- Próxima tarea por prospecto: fecha + nota libre
ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS next_task_date date,
  ADD COLUMN IF NOT EXISTS next_task_note text;
