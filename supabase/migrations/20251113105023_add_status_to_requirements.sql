/*
  # Add Status Column to Requirements

  1. Changes
    - Modify requirements table to support tracking status (on_track, delay_expected)
    - Update existing status field to use proper enum values
  
  2. Notes
    - Status will be used to color-code assignments in the UI
    - 'on_track' = green, 'delay_expected' = orange
*/

DO $$
BEGIN
  -- Update the status field for the AF-TWK requirement to 'on_track'
  UPDATE requirements 
  SET status = 'on_track' 
  WHERE tail_number = 'AF-TWK';

  -- Update the status field for the FK-LMN requirement to 'delay_expected'
  UPDATE requirements 
  SET status = 'delay_expected' 
  WHERE tail_number = 'FK-LMN';
  
  -- Update the status field for the AM-RTK requirement to 'on_track' (default)
  UPDATE requirements 
  SET status = 'on_track' 
  WHERE tail_number = 'AM-RTK';
END $$;