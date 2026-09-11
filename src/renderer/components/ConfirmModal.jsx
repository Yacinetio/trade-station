import React from 'react';

export default function ConfirmModal({
  title = 'Confirm action',
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  confirmDisabled = false,
  /** Notice mode: hide the cancel button (single "OK"-style dialog). */
  hideCancel = false,
  onCancel,
  onConfirm,
  children = null
}) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onCancel}>x</button>
        </div>
        <div className="modal-body">
          {message && <p className="confirm-message">{message}</p>}
          {children}
        </div>
        <div className="modal-footer">
          {!hideCancel && <button className="btn btn-outline" onClick={onCancel}>{cancelLabel}</button>}
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
