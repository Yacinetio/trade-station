import React, { useCallback, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import * as Checkbox from '@radix-ui/react-checkbox';

export default function AccountScopePicker({
  selectedAccountKeys = [],
  accountOptions = [],
  onSelectedAccountsChange,
  /** Opens confirmation elsewhere; closes popover on click */
  onDeleteSelectedAccounts,
  deleteAccountsDisabled = false,
  deleteAccountsTitle = 'Delete selected accounts (local trades and registry)',
  className = ''
}) {
  const [open, setOpen] = useState(false);
  const selectedCount = Array.isArray(selectedAccountKeys) ? selectedAccountKeys.length : 0;
  const options = Array.isArray(accountOptions) ? accountOptions : [];

  const rowChecked = useCallback(
    (accKey) => (selectedAccountKeys || []).some((x) => String(x) === String(accKey)),
    [selectedAccountKeys]
  );

  const toggleAccount = (accKey) => {
    const sk = String(accKey);
    const current = Array.isArray(selectedAccountKeys) ? selectedAccountKeys : [];
    const has = current.some((x) => String(x) === sk);
    const next = has ? current.filter((x) => String(x) !== sk) : [...current, accKey];
    onSelectedAccountsChange?.(next);
  };

  const handleDeleteClick = (e) => {
    e.preventDefault();
    onDeleteSelectedAccounts?.();
    setOpen(false);
  };

  return (
    <div className="onboarding-anchor-account-scope" data-onboarding="account-scope-picker">
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`titlebar-select titlebar-select-account account-scope-trigger ${className}`}
          data-testid="account-scope-trigger"
          title="Select one or multiple accounts"
          aria-label={selectedCount === 0 ? 'Account scope: all accounts' : `Account scope: ${selectedCount} account(s) selected`}
        >
          {selectedCount === 0 ? 'All Accounts' : `${selectedCount} account(s)`}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="account-scope-list" side="bottom" align="end" sideOffset={8}>
          <div className="account-scope-list-scroll">
            <label className="account-scope-item">
              <Checkbox.Root
                className="account-scope-checkbox"
                checked={selectedCount === 0}
                onCheckedChange={() => onSelectedAccountsChange?.([])}
              >
                <Checkbox.Indicator className="account-scope-checkbox-indicator">✓</Checkbox.Indicator>
              </Checkbox.Root>
              <span>All Accounts</span>
            </label>
            {options.map((acc) => (
              <label key={acc.key} className="account-scope-item" title={acc.label}>
                <Checkbox.Root
                  className="account-scope-checkbox"
                  checked={rowChecked(acc.key)}
                  onCheckedChange={() => toggleAccount(acc.key)}
                >
                  <Checkbox.Indicator className="account-scope-checkbox-indicator">✓</Checkbox.Indicator>
                </Checkbox.Root>
                <span>{acc.label}</span>
              </label>
            ))}
          </div>
          {typeof onDeleteSelectedAccounts === 'function' && (
            <div className="account-scope-footer">
              <button
                type="button"
                className="btn-delete-account account-scope-delete-btn"
                disabled={deleteAccountsDisabled}
                title={
                  deleteAccountsDisabled && selectedCount === 0
                    ? 'Select account(s) above first'
                    : deleteAccountsTitle
                }
                onClick={handleDeleteClick}
              >
                Delete account(s)
              </button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
    </div>
  );
}
