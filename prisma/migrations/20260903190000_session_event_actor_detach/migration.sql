-- ---------------------------------------------------------------------------
-- A Person who has ever edited a Session can be deleted (issue #127)
-- ---------------------------------------------------------------------------
--
-- session_event.actor_person_id is ON DELETE SET NULL, and deny_mutation()
-- permitted exactly ONE update shape on session_event: session_id and/or
-- counterpart_session_id cleared, nothing else changed. The cascade's
-- UPDATE ... SET actor_person_id = NULL matched no branch and hit the RAISE,
-- so the parent DELETE aborted:
--
--     ERROR: session_event is append-only; UPDATE is not permitted
--
-- The FOURTH instance of the same shape (a referential action the schema
-- declares, refused by a trigger on the same table), and the twin of the
-- generation.created_by_id fix one column across: reachable from
-- /manage/persons behind person.delete, surfacing as a 409 carrying the raw
-- trigger text for anyone who had ever moved, swapped, locked, banked or
-- substituted a Session.
--
-- The exemption is widened on the SAME terms as the existing one, not
-- loosened: actor_person_id may be CLEARED, never repointed, with nothing
-- else in the row changed, and at least one of the three columns must
-- actually be detached so a no-op UPDATE is still refused. Authorship
-- degrades to unknown rather than to a lie about who acted; the event
-- itself, its type, payload and sequence stay frozen.
--
-- REVOKE UPDATE ON session_event FROM calendry_app is not in the way: a
-- cascade runs with the privileges of the constraint, not the caller.

CREATE OR REPLACE FUNCTION calendry_internal.deny_mutation() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    -- OLD with exactly the three detachable columns NEW claims, and nothing
    -- else changed. If NEW still differs from this, some other column was
    -- touched.
    detached public.session_event;
BEGIN
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'session_event' THEN
        detached := OLD;
        detached.session_id := NEW.session_id;
        detached.counterpart_session_id := NEW.counterpart_session_id;
        detached.actor_person_id := NEW.actor_person_id;

        IF NEW IS NOT DISTINCT FROM detached
           -- No column may be REPOINTED; only cleared.
           AND (NEW.session_id IS NULL OR NEW.session_id = OLD.session_id)
           AND (NEW.counterpart_session_id IS NULL
                OR NEW.counterpart_session_id = OLD.counterpart_session_id)
           AND (NEW.actor_person_id IS NULL OR NEW.actor_person_id = OLD.actor_person_id)
           -- And at least one of them must actually be a detach, so a no-op
           -- UPDATE is still refused rather than quietly accepted.
           AND ((OLD.session_id IS NOT NULL AND NEW.session_id IS NULL)
                OR (OLD.counterpart_session_id IS NOT NULL
                    AND NEW.counterpart_session_id IS NULL)
                OR (OLD.actor_person_id IS NOT NULL AND NEW.actor_person_id IS NULL))
        THEN
            RETURN NEW;
        END IF;
    END IF;

    -- A DELETE that is a CASCADE from the owning Tenant: the parent row is
    -- already gone by the time its cascade fires, and a direct DELETE is not,
    -- so this permits exactly the one case and nothing adjacent.
    IF TG_OP = 'DELETE'
       AND NOT EXISTS (SELECT 1 FROM public.tenant WHERE id = OLD.tenant_id)
    THEN
        RETURN OLD;
    END IF;

    RAISE EXCEPTION
        '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
END $$;
