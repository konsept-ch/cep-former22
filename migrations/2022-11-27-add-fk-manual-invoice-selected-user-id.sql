ALTER TABLE
    former22_manual_invoice
ADD
    COLUMN selectedUserId INT COMMENT 'when private organization is selected, a user must be selected';

ALTER TABLE
    former22_manual_invoice
ADD
    INDEX invoice_selected_user_index (selectedUserId);

ALTER TABLE
    former22_manual_invoice
ADD
    CONSTRAINT fk_invoice_selected_user FOREIGN KEY (selectedUserId) REFERENCES claro_user (id);