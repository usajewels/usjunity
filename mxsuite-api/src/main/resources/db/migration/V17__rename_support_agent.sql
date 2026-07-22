-- Rename the seed "Support Agent" user to "Onboarding Coach"
UPDATE users
SET first_name = 'Onboarding', last_name = 'Coach'
WHERE id = '00000000-0000-0000-0000-000000000011'
  AND first_name = 'Support' AND last_name = 'Agent';
