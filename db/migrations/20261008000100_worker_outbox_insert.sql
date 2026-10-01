-- migrate:up
-- M8: worker phát ObservationsAdded trong cùng transaction với observations.
-- 0004 chỉ GRANT UPDATE trên outbox_events, không có INSERT.

GRANT INSERT ON outbox_events TO hcn_worker;

-- migrate:down
REVOKE INSERT ON outbox_events FROM hcn_worker;
